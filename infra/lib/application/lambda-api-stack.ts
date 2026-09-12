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

    // Geoapify API key (Places search, see docs/adr/0003) — same
    // SSM-SecureString-by-name pattern as the DSN.
    const geoapifyKeyParam = StringParameter.fromSecureStringParameterAttributes(
      this,
      "GeoapifyApiKey",
      { parameterName: "/recipe-manager/geoapify/api-key" },
    );

    const recipeApi = new PythonFunction(this, "RecipeAPI", {
      entry: "../backend",
      runtime: Runtime.PYTHON_3_13,
      index: "src/main.py",
      handler: "handler",
      functionName: constants.RECIPE_API_FUNCTION_NAME,
      description: "Recipe Manager API — FastAPI + Neon PostgreSQL",
      timeout: Duration.seconds(30),
      // Lambda allocates CPU in proportion to memory, and this function is
      // CPU-bound rather than memory-bound: it peaks at ~233 MB, but 512 MB
      // buys only ~0.3 vCPU, which throttles both import-heavy init and
      // per-request Pydantic validation. Free at this volume — 481
      // invocations/month is ~0.04% of the 400,000 GB-s perpetual free tier.
      memorySize: 1024,
      // No vpc config — Lambda is outside the VPC (Neon is reached over the public internet)
      environment: {
        POSTGRES_DSN_PARAM: dsnParam.parameterName,
        GEOAPIFY_API_KEY_PARAM: geoapifyKeyParam.parameterName,
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

    // Allow Lambda to read the Neon DSN and Geoapify key SecureString parameters
    dsnParam.grantRead(recipeApi);
    geoapifyKeyParam.grantRead(recipeApi);

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

    // Sub-paths are NOT covered by /users/me — HTTP API matches routes exactly,
    // so each one needs its own entry or the gateway 404s it before the Lambda
    // is ever invoked.
    httpApi.addRoutes({
      path: "/users/me/reviews",
      methods: [HttpMethod.GET],
      integration,
      authorizer,
    });

    httpApi.addRoutes({
      path: "/users/me/stats",
      methods: [HttpMethod.GET],
      integration,
      authorizer,
    });

    httpApi.addRoutes({
      path: "/restaurants",
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration,
      authorizer,
    });

    httpApi.addRoutes({
      path: "/restaurants/{restaurant_id}",
      methods: [HttpMethod.GET, HttpMethod.PUT],
      integration,
      authorizer,
    });

    httpApi.addRoutes({
      path: "/cuisines",
      methods: [HttpMethod.GET],
      integration,
      authorizer,
    });

    httpApi.addRoutes({
      path: "/places/search",
      methods: [HttpMethod.GET],
      integration,
      authorizer,
    });

    httpApi.addRoutes({
      path: "/places/nearby",
      methods: [HttpMethod.GET],
      integration,
      authorizer,
    });

    httpApi.addRoutes({
      path: "/places/areas",
      methods: [HttpMethod.GET],
      integration,
      authorizer,
    });

    httpApi.addRoutes({
      path: "/places/reverse",
      methods: [HttpMethod.GET],
      integration,
      authorizer,
    });

    httpApi.addRoutes({
      path: "/restaurants/{restaurant_id}/reviews",
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration,
      authorizer,
    });

    httpApi.addRoutes({
      path: "/restaurants/{restaurant_id}/reviews/{review_id}",
      methods: [HttpMethod.PUT, HttpMethod.DELETE],
      integration,
      authorizer,
    });

    // ── Meal planner (docs/plans/meal-planner-plan.md §8) ──────────────────
    //
    // Eight routes, and the shape is driven partly by this file: HTTP API
    // matches exactly, so every path costs an entry here. That is why the slot
    // upsert is one PUT rather than a create/update pair, why closing the
    // calendar and closing the list share one endpoint that takes the status it
    // is leaving, and why reading one week by id is a query parameter on /plans
    // rather than a /plans/{plan_id} that would sit next to /plans/archive.
    httpApi.addRoutes({
      path: "/plans",
      methods: [HttpMethod.GET],
      integration,
      authorizer,
    });

    // Not a sub-path of /plans/{plan_id} — the plan is created lazily on the
    // first assignment, so the caller doesn't have an id to send yet.
    httpApi.addRoutes({
      path: "/plans/entries",
      methods: [HttpMethod.PUT],
      integration,
      authorizer,
    });

    httpApi.addRoutes({
      path: "/plans/{plan_id}/entries/{entry_id}",
      methods: [HttpMethod.DELETE],
      integration,
      authorizer,
    });

    // Two segments, so it never collides with /plans/{plan_id}/items below.
    // This is the route that lets a week's list exist before the week has a
    // single dish in it.
    httpApi.addRoutes({
      path: "/plans/items",
      methods: [HttpMethod.POST],
      integration,
      authorizer,
    });

    httpApi.addRoutes({
      path: "/plans/{plan_id}/items",
      methods: [HttpMethod.POST],
      integration,
      authorizer,
    });

    httpApi.addRoutes({
      path: "/plans/{plan_id}/items/{item_id}",
      methods: [HttpMethod.PATCH, HttpMethod.DELETE],
      integration,
      authorizer,
    });

    // The year view (§5.3). A literal path, and there is deliberately no
    // `/plans/{plan_id}` route for it to sit beside — HTTP API matches exactly,
    // so a literal and a greedy sibling would be a real hazard. Reading one week
    // by id is `GET /plans?plan_id=`, on the route already declared above, for
    // exactly that reason.
    httpApi.addRoutes({
      path: "/plans/archive",
      methods: [HttpMethod.GET],
      integration,
      authorizer,
    });

    httpApi.addRoutes({
      path: "/plans/{plan_id}/status",
      methods: [HttpMethod.POST],
      integration,
      authorizer,
    });

    // ── The kitchen (docs/plans/meal-planner-plan.md §8.12) ────────────────
    //
    // Five routes, four of them replacing three that had a direction (share,
    // unshare, and "weeks shared with me"). A week now belongs to a household
    // rather than to a person, so there is nothing to grant and nothing to
    // revoke — only invitations, and answers to them. The fifth, /kitchen/people,
    // is the list the invite picker chooses from; it is a literal path beside
    // the literal /kitchen/members, so there is no greedy sibling to collide with.
    httpApi.addRoutes({
      path: "/kitchen",
      methods: [HttpMethod.GET],
      integration,
      authorizer,
    });

    httpApi.addRoutes({
      path: "/kitchen/members",
      methods: [HttpMethod.POST],
      integration,
      authorizer,
    });

    httpApi.addRoutes({
      path: "/kitchen/people",
      methods: [HttpMethod.GET],
      integration,
      authorizer,
    });

    // Leaving, or withdrawing an invitation you sent. The two permitted targets
    // share one route because they are the same shape; which one you meant is
    // decided by whether the id is your own.
    httpApi.addRoutes({
      path: "/kitchen/members/{user_id}",
      methods: [HttpMethod.DELETE],
      integration,
      authorizer,
    });

    httpApi.addRoutes({
      path: "/kitchen/invitations/{kitchen_id}",
      methods: [HttpMethod.PATCH],
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
