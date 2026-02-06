import { Stack, StackProps, App, RemovalPolicy, CfnOutput } from "aws-cdk-lib";
import {
  AttributeType,
  BillingMode,
  Table,
  TableEncryption,
} from "aws-cdk-lib/aws-dynamodb";
import { Constants } from "../utils/constants";

export class DynamoDBStack extends Stack {
  constructor(scope: App, id: string, props: StackProps) {
    super(scope, id, props);

    const constants = new Constants();

    // Create DynamoDB Table with predictable names
    const table = new Table(this, "RecipesTable", {
      tableName: constants.RECIPES_TABLE_NAME,
      partitionKey: { name: "id", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST, //free tier compatible
      removalPolicy: RemovalPolicy.DESTROY, // Data will be lost when stack is deleted
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: false }, // No PITR to reduce costs
      encryption: TableEncryption.AWS_MANAGED, // AWS managed encryption
      //   tags: {
      //     Application: "RecipeManager",
      //     ManagedBy: "CDK",
      //   },
    });

    // Output the table name
    new CfnOutput(this, "RecipesTableName", {
      value: table.tableName,
      description: "The name of the Recipes DynamoDB table",
    });

    new CfnOutput(this, "RecipesTableArn", {
      value: table.tableArn,
      description: "The ARN of the Recipes DynamoDB table",
    });
  }
}
