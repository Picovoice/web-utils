import "./commands";

declare global {
  namespace Cypress {
    interface Chainable {
      /**
       * Custom commands for cypress
       * @example cy.newCommand()
       */
    }
  }
}
