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
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Constants } from "../utils/constants";
import { CognitoStack } from "../foundation/cognito-stack";

/**
 * LambdaApiStack - Application layer
 *
 * Lambda runs OUTSIDE the VPC. It connects to Neon (Postgres in
 * eu-central-1) over the public internet via the pooled endpoint —
 * no VPC, no NAT gateway required.
 *
 * The Neon DSN is stored as an SSM SecureString parameter
 * (/recipe-manager/db/dsn). CloudFormation can't inject an ssm-secure value
 * into a Lambda env var, so we pass the parameter NAME (POSTGRES_DSN_PARAM)
 * and the function fetches+decrypts it at cold start via boto3 — sync
 * psycopg2 + NullPool pattern.
 */
export class LambdaApiStack extends Stack {
  public readonly apiEndpoint: string;

  constructor(
    scope: App,
    id: string,
    props: StackProps,
    cognitoStack: CognitoStack,
  ) {
    super(scope, id, props);

    this.addDependency(cognitoStack);

    const constants = new Constants();

    const authorizer = new HttpJwtAuthorizer(
      "CognitoAuthorizer",
      `https://cognito-idp.${this.region}.amazonaws.com/${cognitoStack.userPool.userPoolId}`,
      {
        jwtAudience: [cognitoStack.userPoolClient.userPoolClientId],
        authorizerName: "recipe-manager-cognito-authorizer",
      },
    );

    // Neon DSN lives in SSM as a SecureString. We pass its NAME to the Lambda
    // (ssm-secure values can't be resolved into env vars) and fetch it at
    // cold start. grantRead below gives the function ssm:GetParameter.
    const dsnParam = StringParameter.fromSecureStringParameterAttributes(
      this,
      "DbDsn",
      { parameterName: "/recipe-manager/db/dsn" },
    );

    const recipeApi = new PythonFunction(this, "RecipeAPI", {
      entry: "../backend",
      runtime: Runtime.PYTHON_3_13,
      index: "src/main.py",
      handler: "handler",
      functionName: constants.RECIPE_API_FUNCTION_NAME,
      description: "Recipe Manager API — FastAPI + Neon PostgreSQL",
      timeout: Duration.seconds(30),
      memorySize: 512,
      // No vpc config — Lambda is outside the VPC (Neon is reached over the public internet)
      environment: {
        POSTGRES_DSN_PARAM: dsnParam.parameterName,
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

    // Allow Lambda to read the Neon DSN SecureString parameter
    dsnParam.grantRead(recipeApi);

    const httpApi = new HttpApi(this, "RecipeHttpApi", {
      apiName: constants.RECIPE_API_GATEWAY_NAME,
      description: "HTTP API for Recipe Manager",
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          CorsHttpMethod.PUT,
          CorsHttpMethod.PATCH,
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

    httpApi.addRoutes({
      path: "/users/me",
      methods: [HttpMethod.GET, HttpMethod.PATCH],
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
