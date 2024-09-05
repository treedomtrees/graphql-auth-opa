/* eslint-disable @typescript-eslint/no-explicit-any */
import type { GraphQLSchema, GraphQLFieldConfig } from "graphql";
import { defaultFieldResolver } from "graphql";

import {
  createGraphQLError,
  getDirective,
  MapperKind,
  mapSchema,
} from "@graphql-tools/utils";

import { GraphqlOpaDirectiveOptions } from "./types/graphqlOpaDirectiveOptions";
import { BaseLogger } from "pino";

interface OpaClient {
  evaluatePolicy(string: string, args: Record<string, any>): Promise<boolean>;
}

export const opaAuthTransformer =
  (
    opaClient: OpaClient,
    logger: BaseLogger,
    options?: GraphqlOpaDirectiveOptions,
  ) =>
  (schema: GraphQLSchema) => {
    const executeDirective = (
      fieldConfig: GraphQLFieldConfig<any, any, any>,
    ) => {
      const contextField = options?.requestContextField ?? "req";
      const opaDirective = getDirective(
        schema,
        fieldConfig,
        options?.directiveName ?? "opa",
      )?.[0];

      if (opaDirective) {
        /* c8 ignore next */
        const { resolve = defaultFieldResolver } = fieldConfig;

        fieldConfig.resolve = async function (source, args, context, info) {
          const path = opaDirective.path;

          const options = opaDirective.options;

          const requestContext = context[contextField];

          // console.log(requestContext)
          const allowed = await opaClient
            .evaluatePolicy(path, {
              headers: requestContext.headers,
              parent: source,
              args,
              options,
            })
            .catch((err) => {
              logger.error({ err }, "Error while evaluating OPA policy");

              throw createGraphQLError("Internal Server Error", {
                extensions: { code: "NOT_AUTHORIZED" },
              });
            });

          if (!allowed) {
            throw createGraphQLError("Not authorized", {
              extensions: { code: "NOT_AUTHORIZED" },
            });
          }

          return resolve(source, args, context, info);
        };

        return fieldConfig;
      }
    };

    return mapSchema(schema, {
      [MapperKind.OBJECT_FIELD]: executeDirective,
      [MapperKind.FIELD]: executeDirective,
    });
  };

// export const opaAuthPlugin: FastifyPluginCallback<PluginProps> = fp(
//   async (app: FastifyInstance, props: PluginProps) => {
//     const opa = new OpenPolicyAgentClient(props.opaOptions);

//     app.decorate("opa", opa);

//     app.register<MercuriusAuthOptions>(mercuriusAuth, {
//       /**
//        * Build MercuriusAuthContext contained in context.auth
//        */
//       authContext: props.authContext,

//       /**
//        * Validate directive
//        */
//       async applyPolicy(ast, parent, args, context) {
//         const { path, options } = parseDirectiveArgumentsAST(ast.arguments) as {
//           path: string;
//           options?: object;
//         };

//         const allowed = await app.opa
//           .query(path, {
//             headers: context.reply.request.headers,
//             parent,
//             args,
//             options
//           })
//           .catch((err) => {
//             app.log.error({ err }, "Error while evaluating OPA policy");

//             throw new mercurius.ErrorWithProps("Internal Server Error", {
//               code: "NOT_AUTHORIZED"
//             });
//           });

//         if (!allowed.result) {
//           throw new mercurius.ErrorWithProps("Not authorized", {
//             code: "NOT_AUTHORIZED"
//           });
//         }

//         return true;
//       },
//       authDirective: props?.authDirective ?? "opa"
//     });

//     app.log.debug({}, "OpaAuthPlugin loaded");
//   },
//   { name: "opa-auth", dependencies: ["mercurius"] }
// );

// declare module "fastify" {
//   interface FastifyInstance {
//     opa: OpenPolicyAgentClient<Cache>;
//   }
// }
