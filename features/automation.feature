Feature: Persistent automations
  As the owner of my home memory server
  I want scheduled and memory-triggered tasks to run safely
  So that their results are delivered as local notifications

  Scenario: Run an automation manually and acknowledge its notification
    Given there is an automation named "Daily check" triggered by "memory.updated"
    When the user runs the automation now
    Then the latest automation run should succeed
    And one unread automation notification should be available
    When the user marks the latest automation notification as read
    Then there should be no unread automation notifications

  Scenario: Start an automation when a memory is created
    Given there is an automation named "Review new memory" triggered by "memory.created"
    When a memory with category "Travel" and content "I enjoy day hikes." is created
    Then the latest automation run should succeed
    And one unread automation notification should be available
