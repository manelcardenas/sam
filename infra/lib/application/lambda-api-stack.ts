import { App, CfnOutput, Duration, Stack, StackProps } from "aws-cdk-lib";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { Table } from "aws-cdk-lib/aws-dynamodb";
import {
  CorsHttpMethod,
  HttpApi,
  HttpMethod,
} from "aws-cdk-lib/aws-apigatewayv2";
import { PythonFunction } from "@aws-cdk/aws-lambda-python-alpha";
import { Constants } from "../utils/constants";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { CognitoStack } from "../foundation/cognito-stack";

export class LambdaApiStack extends Stack {
  constructor(
    scope: App,
    id: string,
    props: StackProps,
    cognitoStack: CognitoStack,
  ) {
    super(scope, id, props);

    // Ensure Cognito stack is deployed before this stack
    this.addDependency(cognitoStack);

    const constants = new Constants();

    // ⚠️ fromLookup - NO CloudFormation dependency!
    const table = Table.fromTableName(
      this,
      "RecipesTable",
      constants.RECIPES_TABLE_NAME,
    );

    // Lambda function for API
    const recipeApi = new PythonFunction(this, "RecipeAPI", {
      entry: "../backend", // Points to backend/ directory (contains pyproject.toml, uv.lock, and src/)
      runtime: Runtime.PYTHON_3_13,
      index: "src/main.py",
      handler: "handler", //Magum handler in main.py
      functionName: constants.RECIPE_API_FUNCTION_NAME,
      timeout: Duration.seconds(30),
      memorySize: 512,
      environment: {
        USE_DYNAMODB: "true",
        TABLE_NAME: table.tableName,
        COGNITO_USER_POOL_ID: cognitoStack.userPool.userPoolId,
        COGNITO_CLIENT_ID: cognitoStack.userPoolClient.userPoolClientId,
        //AWS_REGION: this.region,
      },
      bundling: {
        // CDK automatically bundles dependencies from pyproject.toml
        // PythonFunction uses docker to build with Python 3.13
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
          "Dockerfile", // exclude the Docker file we have in backend/
          ".dockerignore",
        ],
      },
    });

    // Grant Lambda permissions to access DynamoDB table
    table.grantReadWriteData(recipeApi);

    // API Gateway HTTP API (This is cheaper than REST API)
    const httpApi = new HttpApi(this, "RecipeHttpApi", {
      apiName: constants.RECIPE_API_GATEWAY_NAME,
      description: "HTTP API for Recipe Manager",
      corsPreflight: {
        allowOrigins: ["*"], // TODO: Change this once frontend is hosted
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

    // Lambda integration
    const integration = new HttpLambdaIntegration(
      "RecipeIntegration",
      recipeApi,
    );

    // Add routes to API Gateway
    httpApi.addRoutes({
      path: "/{proxy+}",
      methods: [HttpMethod.ANY],
      integration: integration,
    });

    httpApi.addRoutes({
      path: "/",
      methods: [HttpMethod.ANY],
      integration: integration,
    });

    // Outputs
    new CfnOutput(this, "ApiEndpoint", {
      value: httpApi.apiEndpoint,
      description: "The endpoint of the Recipe Manager HTTP API",
    });

    new CfnOutput(this, "FunctionName", {
      value: recipeApi.functionName,
      description: "The name of the Recipe Manager Lambda function",
    });

    new CfnOutput(this, "FunctionArn", {
      value: recipeApi.functionArn,
      description: "The ARN of the Recipe Manager Lambda function",
    });
  }
}
