# @treedom/graphql-auth-opa

<a href="https://www.treedom.net/it/organization/treedom/event/treedom-open-source?utm_source=github"><img src="https://badges.treedom.net/badge/f/treedom-open-source?utm_source=github" alt="plant-a-tree" border="0" /></a>

GraphQL Auth OPA is a directive for GraphQL Schema that adds an Authentication and Authorization directive using Open Policy Agent

__Made with ❤️ at&nbsp;&nbsp;[<img src="https://assets.treedom.net/image/upload/manual_uploads/treedom-logo-contrib_gjrzt6.png" height="24" alt="Treedom" border="0" align="top" />](#-join-us-in-making-a-difference-)__, [join us in making a difference](#-join-us-in-making-a-difference-)!

## Usage

```typescript
import { opaAuthDirective } from "@treedom/graphql-auth-opa/opaAuthDirective";
// You could also use the @styra/opa OpaClient
import { OpenPolicyAgentClient } from "@treedom/opa-client-sdk";
// 

// Include the directive in the schema
const typeDefs = `#graphql
${opaAuthDirective}

type Query {
  ping(message: String!): String! @opa(path: "my/opa/policy", options: { ... })
}
`

// Configure OPA auth transformer
const opaTransformer =  opaAuthDirective(
  {
    requestContextField?: string // default: 'req' 
    directiveName?: string
  }
)

// Apply the transformer function to the schema
const schema = opaTransformer(makeExecutableSchema({ typeDefs }))

// if you want the context apply it to the Apollo context type
type MyContext = {request: IncomingMessage}

const server = new ApolloServer<MyContext>({
  schema
});

// Start apollo with standalone server

const { url } = await startStandaloneServer(server, {
  // require an http.IncomingMessage implementation 
  context: async ({ req }) => ({ request: req }),
});
```

## OPA policy input

This plugin queries OPA providing the following properties as `input`:

- `headers` the headers object, this require a context request forwarding
- `parent` the GraphQL parent object of the field/object which got queried
- `args` the GraphQL args object of the field/object which got queried
- `options` static untyped properties defined in the directive arguments _(optional)_

### Example Rego Policy

Let's imagine a GraphQL server which accept requests authorized using JWTs containing the `role` property in their claims.
The following Rego uses a hypotetical `oidc.verify_token` that validates the JWT signature and returns the token claims
or false if the token is not valid.

```rego
package my.opa.policy

import rego.v1
import data.oidc

default allow := false

allow if {
    user := oidc.verify_token(input.headers.authorization)

    user
    user.role = "admin"
}
```

## Headers forwarding

If you need to forward the headers to OPA you can use the `requestContextField` option to specify the name of the request context field.

To do that you need to manually build the context by adding the request object. 

> Currently the request should have a `headers` property with `http.IncomingHttpHeaders` type. 
> Compatible with `FastifyRequest<...>` and `http.IncomingRequest`.

### Apollo Server Example
```typescript
import { IncomingMessage } from 'node:http'

type MyContext { 
  req: IncomingMessage
}

const opaClient = new OpenPolicyAgentClient({
  url: 'http://opa.test:3000',
})

const transformer = opaTransformer(opaClient, {
  requestContextField: 'req' // should be the name of the request context field
})

const schema = transformer(makeExecutableSchema({ typeDefs, ... }))


const server = new ApolloServer<MyContext>({...})

const { url } = await startStandaloneServer(server, {
  context: async (ctx) => (ctx),
});

```

### Fastify Example

```typescript
import fastify, { FastifyRequest } from 'fastify'
import fastifyApollo, {
  fastifyApolloDrainPlugin,
} from '@as-integrations/fastify'

type MyContext = {
  request: FastifyRequest
}

const opaClient = new OpenPolicyAgentClient({
  url: 'http://opa.test:3000',
})

const transformer = opaTransformer(opaClient, {
  requestContextField: 'request' // should be the name of the request context field
})

const schema = transformer(makeExecutableSchema({ typeDefs, ... }))


const apolloServer = new ApolloServer<ApolloContext>({
    schema,
    plugins: [fastifyApolloDrainPlugin(app)],
  })

  await apolloServer.start()

  app.log.debug({}, 'Apollo Server plugin loaded')

  // Build context function
  await app.register(fastifyApollo(apolloServer), {
    context: async (request) => {
      return {
        request, // FastifyRequest
      }
    },
  })

```


## Custom directive

The authorization directive can be customized registering a custom one in the schema and specifying its name in the plugin configuration

```graphql
scalar OpaOptions
directive @policy(path: String!, options: OpaOptions) on OBJECT | FIELD_DEFINITION
```

```typescript
const transformer = opaTransformer(opaClient, {
  authDirective: 'policy'
  opaOptions: {
    // ...
  }
})

```

## 🌳 Join Us in Making a Difference! 🌳

We invite all developers who use Treedom's open-source code to support our mission of sustainability by planting a tree with us. By contributing to reforestation efforts, you help create a healthier planet and give back to the environment. Visit our [Treedom Open Source Forest](https://www.treedom.net/en/organization/treedom/event/treedom-open-source) to plant your tree today and join our community of eco-conscious developers.

Additionally, you can integrate the Treedom GitHub badge into your repository to showcase the number of trees in your Treedom forest and encourage others to plant new ones. Check out our [integration guide](https://github.com/treedomtrees/.github/blob/main/TREEDOM_BADGE.md) to get started.

Together, we can make a lasting impact! 🌍💚

## Contributing

Contributions are welcome! Please read the contributing guidelines before submitting a pull request.

## License

This project is licensed under the MIT License.