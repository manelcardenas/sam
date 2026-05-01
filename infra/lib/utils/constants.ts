export class Constants {
  // VPC
  readonly VPC_NAME = "recipe-manager-vpc";

  // Aurora PostgreSQL
  readonly DB_SECRET_NAME = "recipe-manager/aurora-credentials";
  readonly DB_NAME = "recipe_manager";

  // Lambda
  readonly RECIPE_API_FUNCTION_NAME = "recipe-manager-api";

  // API Gateway
  readonly RECIPE_API_GATEWAY_NAME = "recipe-manager-api";

  // CI/CD
  readonly GITHUB_OIDC_PROVIDER_SSM_PARAM =
    "/recipe-manager/github-oidc-provider-arn";
  readonly CI_ROLE_NAME = "recipe-manager-ci-role";
}
