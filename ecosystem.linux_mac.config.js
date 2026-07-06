module.exports = {
  apps: [
    {
      name: "intraview-server",
      cwd: "./server",
      script: "npm",
      args: "run start",
      env: {
        NODE_ENV: "development",
      }
    },
    {
      name: "intraview-frontend",
      cwd: "./frontend",
      script: "npm",
      args: "run dev",
      env: {
        NODE_ENV: "development",
      }
    }
  ]
};
