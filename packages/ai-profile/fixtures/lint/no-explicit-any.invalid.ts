// expect: typescript(no-explicit-any)
// `any` turns off type checking for everything the value touches.
export type Payload = { body: any };
