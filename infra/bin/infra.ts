#!/usr/bin/env node
import "source-map-support/register";
import { App } from "aws-cdk-lib";
import { CognitoStack } from "../lib/foundation/cognito-stack";

// Since ADR 0008 the API and the web run on Vercel, so the only AWS resource
// left is Cognito (sign-in). Deploy it by hand:
//   npx cdk diff RecipeManagerCognitoStack
//   npx cdk deploy RecipeManagerCognitoStack
const app = new App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: "eu-west-3",
};

// Its OAuth callback/logout URLs include the web's origin, `webDomain` in
// cdk.json. Changing it means redeploying this stack (and updating the API's
// CORS_ALLOW_ORIGINS on Vercel).
new CognitoStack(app, "RecipeManagerCognitoStack", {
  env,
  webDomain: app.node.tryGetContext("webDomain"),
});
