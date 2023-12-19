declare module 'web-worker:*' {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}

declare module "*.wasm" {
  const content: string;
  export default content;
}
