Feature: Explicit memory creation
  As the owner of my memory store
  I want to approve new memories proposed by the assistant
  So that I can keep useful information without accidental writes

  Scenario: Store an explicitly remembered hiking preference
    Given the user has no stored memories
    When the user says "Remember that I always take a headlamp when hiking"
    Then the assistant should propose a new memory
    And the memory store should still be empty
    When the user approves the proposed memory
    Then the hiking memory should contain "headlamp"
    And exactly one memory should be stored

  Scenario: Do not store an equivalent memory twice
    Given the assistant already remembers "User carries a headlamp when hiking" in category "hiking"
    When the user proposes the same memory with different spacing
    Then no duplicate memory should be stored
    And exactly one memory should be stored
