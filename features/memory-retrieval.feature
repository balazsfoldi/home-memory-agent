Feature: Relevant memory retrieval
  As the owner of a personal assistant
  I want only memories relevant to my question to be used
  So that irrelevant personal information stays out of the answer

  Scenario: Include a relevant hiking memory
    Given the assistant remembers "I take a headlamp on hiking trips" in category "hiking"
    And the assistant remembers "I use a power bank when travelling" in category "travel"
    When the user asks "What should I take hiking?"
    Then the "headlamp" memory should be included in the relevant context
    And the "power bank" memory should not be included in the relevant context

  Scenario: An ordinary question does not authorize a memory write
    Given the user has no stored memories
    And the assistant proposes to create "An accidental memory" in category "other"
    When the user asks "What should I pack for a hike?"
    Then no memory action should be proposed
    And the memory store should still be empty
