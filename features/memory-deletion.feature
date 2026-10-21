Feature: Memory deletion
  As the owner of my memory store
  I want to approve removal of information
  So that forgotten details are removed from active memory

  Scenario: Forget one selected hiking memory
    Given the assistant remembers "I always carry cereal bars while hiking" in category "hiking"
    When the user says "Forget that I carry cereal bars while hiking"
    Then the assistant should propose a deletion
    And the memory store should still contain "cereal bars"
    When the user approves the proposed deletion
    Then the memory store should not contain "cereal bars"
    And exactly zero memories should be stored

  Scenario: A model cannot delete a memory that was not presented as a candidate
    Given the assistant remembers "I carry water on hiking trips" in category "hiking"
    And the assistant proposes to delete a memory that is not on the shortlist
    When the user says "Forget the hiking memory"
    Then no memory action should be proposed
    And exactly one memory should be stored
