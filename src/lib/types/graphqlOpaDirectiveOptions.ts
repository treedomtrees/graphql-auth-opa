export type GraphqlOpaDirectiveOptions = {
  directiveName?: string
  /**
   * The context field that extends http.IncomingMessage type   
   * 'req' is the default following the standalone server context
   * https://github.com/apollographql/apollo-server/blob/d20c908b72267ddff045d7774be89a0ca23773ac/packages/server/src/standalone/index.ts#L21
  */ 
  requestContextField?: string
}