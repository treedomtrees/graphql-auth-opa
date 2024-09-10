import { BaseLogger } from 'pino'

export type GraphqlOpaDirectiveOptions = {
  /**
   * Name of the directive without '@'. Default is 'opa'
   * @default opa
   */
  directiveName?: string
  /**
   * The context field that extends http.IncomingMessage type.
   *
   * Default is `req` following {@link  https://github.com/apollographql/apollo-server/blob/d20c908b72267ddff045d7774be89a0ca23773ac/packages/server/src/standalone/index.ts#L21 StandaloneServerContextFunctionArgument}
   * @default 'req' following
   */
  requestContextField?: string
  /**
   * {@link https://github.com/pinojs/pino.git Pino} logger interface
   **/
  logger?: BaseLogger
}
