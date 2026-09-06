declare module "teleproto" {
  // Package is optional at typecheck time in this sandbox. Runtime import is dynamic.
  const teleproto: any;
  export = teleproto;
}
