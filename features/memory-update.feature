Feature: Memory updates
  As the owner of my memory store
  I want to review and approve corrections
  So that outdated memories do not stay active

  Scenario: Approve a more specific hiking preference
    Given the assistant remembers "I always carry 2 litres of water on every hike" in category "hiking"
    When the user says "Change this: I carry 2 litres only on long hikes"
    Then the assistant should propose an update
    And the stored memory should remain unchanged
    When the user approves the proposed update
    Then the hiking memory should contain "only on long hikes"
    And exactly one memory should be stored

  Scenario: Ask before changing one of several matching memories
    Given the assistant remembers "I carry a headlamp on hiking trips" in category "hiking"
    And the assistant remembers "I carry water on hiking trips" in category "hiking"
    And the assistant proposes to update a memory that is not on the shortlist
    When the user says "Change my hiking preferences"
    Then no memory action should be proposed
    And exactly two memories should be stored
