// Films imported as assets (next.config.ts, turbopack.rules): the import is the file's URL.
declare module "*.mp4" {
  const url: string;
  export default url;
}

declare module "*.webm" {
  const url: string;
  export default url;
}
