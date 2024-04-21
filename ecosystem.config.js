module.exports = {
  apps : [{
    name: "AppDistrib",
    script: "./index.js",
    args: "-c /home/appdistrib/config.json"
  }],
  deploy: {
    production: {
      user: "appdistrib",
      host: ["ssh.distrib.app"],
      ref: "origin/main",
      repo: "git@github.com:AppDistrib/AppDistrib.git",
      path: "/home/appdistrib/appdistrib",
      'post-deploy': "npm install && npm run buildFront",
    }
  }
}
