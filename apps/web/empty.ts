// Stand-in for Node built-ins that third-party browser bundles reference but never call in the browser
// (@anchor-lang/core's NodeWallet reads a keypair file with `fs`).
export default {};
