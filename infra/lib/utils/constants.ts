export class Constants {
  // DynamoDB
  readonly RECIPES_TABLE_NAME = "recipes";
  // Lambda
  readonly RECIPE_API_FUNCTION_NAME = "recipe-manager-api";

  //API Gateway
  readonly RECIPE_API_GATEWAY_NAME = "recipe-manager-api";

  // CI/CD
  readonly GITHUB_OIDC_PROVIDER_SSM_PARAM =
    "/recipe-manager/github-oidc-provider-arn";
  readonly CI_ROLE_NAME = "recipe-manager-ci-role";
}
