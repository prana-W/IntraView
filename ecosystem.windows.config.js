module.exports = {
  apps: [
    {
      name: "intraview-server",
      cwd: "./server",
      script: "server.js",
      interpreter: "node",
      env: {
        NODE_ENV: "development",
      },
    },      
    {
      name: "intraview-frontend",
      cwd: "./frontend",
      script: "cmd.exe",
      args: "/c npm run dev",
      interpreter: "none",
      windowsHide: true,
      env: {
        NODE_ENV: "development",
      },
    },
  ],
};