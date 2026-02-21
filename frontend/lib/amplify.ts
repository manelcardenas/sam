import { Amplify } from 'aws-amplify';

const amplifyConfig = {
  Auth: {
    Cognito: {
      userPoolId: process.env.NEXT_PUBLIC_USER_POOL_ID!,
      userPoolClientId: process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID!,
      loginWith: {
        oauth: {
          domain: `${process.env.NEXT_PUBLIC_COGNITO_DOMAIN}.auth.${process.env.NEXT_PUBLIC_AWS_REGION}.amazoncognito.com`,
          scopes: ['email', 'openid', 'profile', 'aws.cognito.signin.user.admin'],
          redirectSignIn: [
            typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8080',
          ],
          redirectSignOut: [
            typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8080',
          ],
          responseType: 'code' as const,
        },
      },
    },
  },
};

export function configureAmplify() {
  Amplify.configure(amplifyConfig, { ssr: true });
}

export default amplifyConfig;
