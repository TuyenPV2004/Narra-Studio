const noop = () => {};

const telemetry = new Proxy({}, {get: () => noop});

export {telemetry as t};
