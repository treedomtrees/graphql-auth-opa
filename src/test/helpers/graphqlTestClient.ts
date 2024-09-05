/* istanbul ignore file */
/* eslint-disable no-async-promise-executor */
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * This a modified version of this repo https://github.com/mercurius-js/mercurius-integration-testing/blob/master/src/index.ts
 * changes:
 * - removed the check of mercurius plugin registration
 * - removed subscription client
 */
import type { FastifyInstance } from "fastify";
import type { IncomingHttpHeaders } from "http";

import { DocumentNode, GraphQLError, print } from "graphql";

// import { SubscriptionClient } from "./subscription/client"

import type { TypedDocumentNode } from "@graphql-typed-document-node/core";

export type GQLResponse<T> = { data: T; errors?: GraphQLError[] };

export type QueryOptions<
  TVariables extends Record<string, unknown> | undefined = undefined,
> = {
  operationName?: string | null;
  headers?: IncomingHttpHeaders;
  cookies?: Record<string, string>;
  variables?: TVariables;
};

export function createGraphqlTestClient(
  /**
   * Fastify instance, in which it should have been implemented a graphql instance on a path (default is '/graphql').
   */
  app: FastifyInstance,
  /**
   * Global Options for the client, including:
   * - headers
   * - url
   * - cookies
   */
  opts: {
    /**
     * Global Headers added to every query in this test client.
     */
    headers?: IncomingHttpHeaders;
    /**
     * GraphQL Endpoint registered on the Fastify instance.
     * By default is `/graphql`
     */
    url?: string;
    /**
     * Global Cookies added to every query in this test client.
     */
    cookies?: Record<string, string>;
  } = {},
): {
  /**
   * Query function.
   *
   * @param query Query to be sent. It can be a DocumentNode or string.
   * @param queryOptions Query specific options, including:
   * - variables
   * - operationName
   * - headers
   * - cookies
   */
  query: <
    TData extends Record<string, unknown> = Record<string, any>,
    TVariables extends Record<string, unknown> | undefined = undefined,
  >(
    query: TypedDocumentNode<TData, TVariables> | DocumentNode | string,
    queryOptions?: QueryOptions<TVariables>,
  ) => Promise<GQLResponse<TData>>;
  /**
   * Mutation function.
   *
   * @param mutation Mutation to be sent. It can be a DocumentNode or string.
   * @param mutationOptions Query specific options, including:
   * - variables
   * - operationName
   * - headers
   * - cookies
   */
  mutate: <
    TData extends Record<string, unknown> = Record<string, any>,
    TVariables extends Record<string, unknown> | undefined = undefined,
  >(
    mutation: TypedDocumentNode<TData, TVariables> | DocumentNode | string,
    mutationOptions?: QueryOptions<TVariables>,
  ) => Promise<GQLResponse<TData>>;

  /**
   * Returns federated entity by provided typename and keys
   * @param options
   * @returns Promise with requested _Entity
   */
  getFederatedEntity: <
    TData extends Record<string, unknown> = Record<string, any>,
  >(options: {
    typename: string;
    keys: Record<string, string | number>;
    typeQuery: string;
  }) => Promise<TData>;

  /**
   * Set new global headers to this test client instance.
   * @param newHeaders new Global headers to be set for the test client.
   */
  setHeaders: (newHeaders: IncomingHttpHeaders) => void;
  /**
   * Set new global cookies to this test client instance.
   * @param newCookies new Global headers to be set for the test client.
   */
  setCookies: (newCookies: Record<string, string>) => void;
  /**
   * Send a batch of queries, make sure to enable `allowBatchedQueries`.
   *
   * https://github.com/mercurius-js/mercurius#batched-queries
   *
   *
   * @param queries Queries to be sent in batch.
   * @param queryOptions Cookies | headers to be set.
   */
  batchQueries: (
    queries: {
      query: DocumentNode | string;
      variables?: Record<string, any>;
      operationName?: string;
    }[],
    queryOptions?: Pick<QueryOptions, "cookies" | "headers">,
  ) => Promise<GQLResponse<any>[]>;
  /**
   * Global headers added to every request in this test client.
   */
  headers: IncomingHttpHeaders;
  /**
   * Global cookies added to every request in this test client.
   */
  cookies: Record<string, string>;
} {
  const readyPromise = new Promise<void>(async (resolve, reject) => {
    try {
      await app.ready();
      resolve();
    } catch (err) {
      if (
        err instanceof Error &&
        err.message === "app.ready is not a function"
      ) {
        return reject(Error("Invalid Fastify Instance"));
      }
      reject(err);
    }
  });
  let headers = opts.headers || {};
  let cookies = opts.cookies || {};

  const url = opts.url || "/graphql";

  const query = async (
    query: string | DocumentNode | TypedDocumentNode,
    queryOptions: QueryOptions<Record<string, unknown> | undefined> = {
      variables: {},
    },
  ) => {
    await readyPromise;
    const {
      variables = {},
      operationName = null,
      headers: querySpecificHeaders = {},
      cookies: querySpecificCookies = {},
    } = queryOptions;

    return (
      await app.inject({
        method: "POST",
        url,
        cookies: {
          ...cookies,
          ...querySpecificCookies,
        },
        headers: {
          "content-type": "application/json; charset=utf-8",
          ...headers,
          ...querySpecificHeaders,
        },
        payload: JSON.stringify({
          query: typeof query === "string" ? query : print(query),
          variables,
          operationName,
        }),
      })
    ).json();
  };

  const setHeaders = (newHeaders: IncomingHttpHeaders) => {
    headers = newHeaders;
  };

  const setCookies = (newCookies: Record<string, string>) => {
    cookies = newCookies;
  };

  const batchQueries = async (
    queries: {
      query: DocumentNode | string;
      variables?: Record<string, unknown>;
      operationName?: string;
    }[],
    queryOptions?: Pick<QueryOptions, "cookies" | "headers">,
  ) => {
    await readyPromise;

    const {
      headers: querySpecificHeaders = {},
      cookies: querySpecificCookies = {},
    } = queryOptions || {};

    const responses: GQLResponse<unknown>[] = (
      await app.inject({
        method: "POST",
        url,
        cookies: {
          ...cookies,
          ...querySpecificCookies,
        },
        headers: {
          "content-type": "application/json; charset=utf-8",
          ...headers,
          ...querySpecificHeaders,
        },
        payload: JSON.stringify(
          queries.map(({ query, variables, operationName }) => {
            return {
              query: typeof query === "string" ? query : print(query),
              variables: variables || {},
              operationName: operationName || null,
            };
          }),
        ),
      })
    ).json();

    return responses;
  };

  const getFederatedEntity = async ({
    typename,
    keys,
    typeQuery,
  }: {
    typename: string;
    keys: Record<string, string | number>;
    typeQuery: string;
  }) => {
    try {
      const result = await query(
        `
      query Entities($representations: [_Any!]!) {
          _entities(representations: $representations) {
            __typename
            ... on ${typename} {
              ${typeQuery}
            }
          }
        }
    `,
        {
          variables: {
            representations: [{ __typename: typename, ...keys }],
          },
        },
      );

      return result.data._entities[0];
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes('Unknown directive "@key"')
      ) {
        throw new Error("Service is not federated");
      }

      throw err;
    }
  };

  return {
    query,
    mutate: query,
    setHeaders,
    headers,
    cookies,
    setCookies,
    batchQueries,
    getFederatedEntity,
  };
}
