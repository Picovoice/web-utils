const { startDevServer } = require('@cypress/webpack-dev-server')

/**
* @type {Cypress.PluginConfig}
*/
// eslint-disable-next-line no-unused-vars
module.exports = (on, config) => {
  on('dev-server:start', (options) => {
    return startDevServer({
      options,
      webpackConfig: {
        resolve: {
          extensions: [".ts", ".js"]
        },
        module: {
          rules: [
            {
              test: /\.ts?$/,
              exclude: /node_modules/,
              loader: 'ts-loader',
              options: {
                compilerOptions: {
                  "noEmit": false
                }
              }
            },
          ]
        }
      }
    })
  })

  return config
}
