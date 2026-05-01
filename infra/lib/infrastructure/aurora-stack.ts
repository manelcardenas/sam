import { Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import {
  AuroraPostgresEngineVersion,
  ClusterInstance,
  Credentials,
  DatabaseCluster,
  DatabaseClusterEngine,
} from "aws-cdk-lib/aws-rds";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Constants } from "../utils/constants";

/**
 * AuroraStack - Infrastructure layer
 *
 * Aurora Serverless v2 PostgreSQL — cost-optimised for a personal project:
 *
 *   - Minimum ACU = 0  → scales to zero when idle → $0/month when not in use
 *   - Maximum ACU = 2  → ~$0.12/ACU·hour under load
 *   - publiclyAccessible = true → Lambda connects without NAT gateway ($35/month saved)
 *   - Placed in public subnets of the VPC (Aurora still requires a VPC)
 *   - Access secured by auto-generated 30-char alphanumeric password in Secrets Manager
 *
 * Security model: public endpoint + strong password + SSL (Aurora default).
 * Acceptable for a personal project. For production, use private subnets + NAT.
 *
 * No cross-stack exports: VPC is resolved via Vpc.fromLookup() (uses cdk.context.json).
 */
export class AuroraStack extends Stack {
  /** Secret that holds { username, password } for the Aurora cluster. */
  public readonly databaseSecret: Secret;

  /** Aurora writer endpoint hostname. */
  public readonly databaseEndpoint: string;

  /** Aurora port (always 5432 for PostgreSQL). */
  public readonly databasePort: string;

  /** Default database name. */
  public readonly databaseName: string;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const constants = new Constants();

    // ⚠️ fromLookup — reads VPC ID from cdk.context.json (no CloudFormation dependency)
    // Run `cdk deploy RecipeManagerVpcStack` first, then commit cdk.context.json.
    const vpc = Vpc.fromLookup(this, "Vpc", {
      vpcName: constants.VPC_NAME,
    });

    // Security group — allows PostgreSQL from anywhere (password is the guard)
    const dbSecurityGroup = new SecurityGroup(this, "AuroraSecurityGroup", {
      vpc,
      description:
        "Aurora PostgreSQL - public access secured by Secrets Manager password",
      allowAllOutbound: false,
      securityGroupName: "recipe-manager-aurora-sg",
    });

    dbSecurityGroup.addIngressRule(
      Peer.anyIpv4(),
      Port.tcp(5432),
      "PostgreSQL public access - password-protected via Secrets Manager",
    );

    // Auto-generated credentials stored in Secrets Manager
    this.databaseSecret = new Secret(this, "AuroraCredentials", {
      secretName: constants.DB_SECRET_NAME,
      description: "Aurora PostgreSQL credentials for Recipe Manager",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "postgres" }),
        generateStringKey: "password",
        excludePunctuation: true, // psycopg2 DSN-safe — no special chars in password
        passwordLength: 32,
      },
    });

    this.databaseName = constants.DB_NAME;

    // Aurora Serverless v2 — scales to 0 ACU when idle (free when not in use)
    const cluster = new DatabaseCluster(this, "AuroraCluster", {
      clusterIdentifier: "recipe-manager-aurora-cluster",
      engine: DatabaseClusterEngine.auroraPostgres({
        version: AuroraPostgresEngineVersion.VER_16_6,
      }),
      writer: ClusterInstance.serverlessV2("writer", {
        publiclyAccessible: true, // Lambda connects from outside VPC — no NAT gateway needed
      }),
      serverlessV2MinCapacity: 0, // Free when idle
      serverlessV2MaxCapacity: 2,
      vpc,
      vpcSubnets: {
        subnetType: SubnetType.PUBLIC, // Public subnet so endpoint is reachable
      },
      securityGroups: [dbSecurityGroup],
      credentials: Credentials.fromSecret(this.databaseSecret),
      defaultDatabaseName: this.databaseName,
      storageEncrypted: true,
      backup: {
        retention: Duration.days(1),
        preferredWindow: "03:00-04:00",
      },
      removalPolicy: RemovalPolicy.SNAPSHOT,
      deletionProtection: false,
    });

    this.databaseEndpoint = cluster.clusterEndpoint.hostname;
    this.databasePort = cluster.clusterEndpoint.port.toString();
  }
}
