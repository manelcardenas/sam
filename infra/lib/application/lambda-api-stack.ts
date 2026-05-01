import { App, CfnOutput, Duration, Stack, StackProps } from "aws-cdk-lib";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import {
  CorsHttpMethod,
  HttpApi,
  HttpMethod,
} from "aws-cdk-lib/aws-apigatewayv2";
import { PythonFunction } from "@aws-cdk/aws-lambda-python-alpha";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { Constants } from "../utils/constants";
import { CognitoStack } from "../foundation/cognito-stack";
import { AuroraStack } from "../infrastructure/aurora-stack";

/**
 * LambdaApiStack - Application layer
 *
 * Lambda runs OUTSIDE the VPC — same as the old DynamoDB setup.
 * Aurora is publicly accessible, so Lambda connects over the internet
 * without needing a NAT gateway (~$35/month saved).
 *
 * Credentials are resolved from Secrets Manager at synth time and
 * injected as Lambda environment variables. No Secrets Manager calls
 * at runtime — sync psycopg2 + NullPool pattern.
 */
export class LambdaApiStack extends Stack {
  public readonly apiEndpoint: string;

  constructor(
    scope: App,
    id: string,
    props: StackProps,
    cognitoStack: CognitoStack,
    auroraStack: AuroraStack,
  ) {
    super(scope, id, props);

    this.addDependency(cognitoStack);
    this.addDependency(auroraStack);

    const constants = new Constants();

    const authorizer = new HttpJwtAuthorizer(
      "CognitoAuthorizer",
      `https://cognito-idp.${this.region}.amazonaws.com/${cognitoStack.userPool.userPoolId}`,
      {
        jwtAudience: [cognitoStack.userPoolClient.userPoolClientId],
        authorizerName: "recipe-manager-cognito-authorizer",
      },
    );

    const recipeApi = new PythonFunction(this, "RecipeAPI", {
      entry: "../backend",
      runtime: Runtime.PYTHON_3_13,
      index: "src/main.py",
      handler: "handler",
      functionName: constants.RECIPE_API_FUNCTION_NAME,
      description: "Recipe Manager API — FastAPI + Aurora PostgreSQL",
      timeout: Duration.seconds(30),
      memorySize: 512,
      // No vpc config — Lambda is outside the VPC (Aurora is publicly accessible)
      environment: {
        POSTGRES_HOST: auroraStack.databaseEndpoint,
        POSTGRES_PORT: auroraStack.databasePort,
        POSTGRES_DB: auroraStack.databaseName,
        POSTGRES_USER: auroraStack.databaseSecret
          .secretValueFromJson("username")
          .unsafeUnwrap(),
        POSTGRES_PASSWORD: auroraStack.databaseSecret
          .secretValueFromJson("password")
          .unsafeUnwrap(),
        COGNITO_USER_POOL_ID: cognitoStack.userPool.userPoolId,
        COGNITO_CLIENT_ID: cognitoStack.userPoolClient.userPoolClientId,
      },
      bundling: {
        assetExcludes: [
          "tests",
          ".venv",
          "__pycache__",
          "*.pyc",
          ".pytest_cache",
          ".ruff_cache",
          "*.egg-info",
          ".env",
          "*.md",
          "Dockerfile",
          ".dockerignore",
        ],
      },
    });

    // Allow Lambda to read the Aurora secret (good IAM hygiene)
    auroraStack.databaseSecret.grantRead(recipeApi);

    const httpApi = new HttpApi(this, "RecipeHttpApi", {
      apiName: constants.RECIPE_API_GATEWAY_NAME,
      description: "HTTP API for Recipe Manager",
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          CorsHttpMethod.PUT,
          CorsHttpMethod.DELETE,
          CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ["Content-Type", "Authorization"],
      },
    });

    const integration = new HttpLambdaIntegration(
      "RecipeIntegration",
      recipeApi,
    );

    httpApi.addRoutes({
      path: "/health",
      methods: [HttpMethod.GET],
      integration,
    });

    httpApi.addRoutes({
      path: "/recipes",
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration,
      authorizer,
    });

    httpApi.addRoutes({
      path: "/recipes/{recipe_id}",
      methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE],
      integration,
      authorizer,
    });

    new CfnOutput(this, "ApiEndpoint", {
      value: httpApi.apiEndpoint,
      description: "Recipe Manager HTTP API endpoint",
    });

    this.apiEndpoint = httpApi.apiEndpoint;

    new CfnOutput(this, "FunctionName", {
      value: recipeApi.functionName,
      description: "Recipe Manager Lambda function name",
    });

    new CfnOutput(this, "FunctionArn", {
      value: recipeApi.functionArn,
      description: "Recipe Manager Lambda function ARN",
    });
  }
}
