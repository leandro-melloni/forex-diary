declare namespace Deno {
  const env: { get(name:string): string | undefined };
  function serve(handler:(req:Request)=>Response|Promise<Response>): unknown;
}
