import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import { Constants } from "../utils/constants";

/**
 * VpcStack - Infrastructure layer
 *
 * Minimal VPC required by Aurora (AWS mandates a VPC for RDS clusters).
 *
 * Cost breakdown:
 *   - VPC:              FREE
 *   - Subnets:          FREE
 *   - Internet Gateway: FREE
 *   - NAT Gateway:      NONE (removed — would cost ~$35/month)
 *
 * Aurora is placed in public subnets with publiclyAccessible=true so
 * that Lambda (outside the VPC) can connect without a NAT gateway.
 * Access is secured by the auto-generated Secrets Manager password.
 *
 * Total infra cost when Aurora is idle at 0 ACU: $0/month
 */
export class VpcStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const constants = new Constants();

    new Vpc(this, "RecipeManagerVpc", {
      vpcName: constants.VPC_NAME,
      natGateways: 0, // Free — no NAT needed (Lambda is outside VPC)
      maxAzs: 2,
      subnetConfiguration: [
        {
          name: "Public",
          subnetType: SubnetType.PUBLIC, // Aurora goes here (publiclyAccessible=true)
          cidrMask: 24,
        },
      ],
    });
  }
}
