Feature: Assistant conversations
  As the owner of a home-hosted assistant
  I want it to use only useful memories in my conversation
  So that I receive a personal answer without sharing my whole memory store

  Scenario: A hiking question includes relevant context
    Given the assistant remembers "I carry a headlamp for evening hikes" in category "hiking"
    When the user asks "What should I bring hiking?"
    Then the "headlamp" memory should be included in the relevant context

  Scenario: A model must not say it changed memory before approval
    Given the assistant remembers "I pack 2 litres of water on every hike" in category "hiking"
    When the user says "Change this: I pack 2 litres only on long hikes"
    Then the assistant should propose an update
    And the stored memory should remain unchanged
