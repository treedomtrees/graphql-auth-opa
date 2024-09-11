/* eslint-disable @typescript-eslint/no-explicit-any */
import type { GraphQLSchema, GraphQLFieldConfig } from 'graphql'
import { defaultFieldResolver } from 'graphql'

import {
  createGraphQLError,
  getDirective,
  MapperKind,
  mapSchema,
} from '@graphql-tools/utils'

import { GraphqlOpaDirectiveOptions } from './types/graphqlOpaDirectiveOptions'

interface OpaClient {
  evaluate(string: string, args: Record<string, any>): Promise<boolean>
}

export const opaAuthTransformer =
  (opaClient: OpaClient, options?: GraphqlOpaDirectiveOptions) =>
  (schema: GraphQLSchema) => {
    const logger = options?.logger
    const directiveName = options?.directiveName || 'opa'

    const executeDirective = (
      fieldConfig: GraphQLFieldConfig<any, any, any>
    ) => {
      const contextField = options?.requestContextField
      const opaDirective = getDirective(schema, fieldConfig, directiveName)?.[0]

      if (opaDirective) {
        /* c8 ignore next */
        const { resolve = defaultFieldResolver } = fieldConfig

        fieldConfig.resolve = async function (source, args, context, info) {
          const path = opaDirective.path

          const options = opaDirective.options

          const requestContext =
            typeof contextField === 'string' ? context[contextField] : undefined

          const allowed = await opaClient
            .evaluate(path, {
              headers: requestContext?.headers,
              parent: source,
              args,
              options,
            })
            .catch((err) => {
              logger?.error({ err }, 'Error while evaluating OPA policy')

              throw createGraphQLError('Internal Server Error', {
                extensions: { code: 'NOT_AUTHORIZED' },
              })
            })

          if (!allowed) {
            throw createGraphQLError('Not authorized', {
              extensions: { code: 'NOT_AUTHORIZED' },
            })
          }

          return resolve(source, args, context, info)
        }

        return fieldConfig
      }
    }

    return mapSchema(schema, {
      [MapperKind.OBJECT_FIELD]: executeDirective,
      [MapperKind.FIELD]: executeDirective,
    })
  }
