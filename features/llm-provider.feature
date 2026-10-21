Feature: Replaceable language-model providers
  As the owner of a private assistant
  I want provider details to remain behind an adapter
  So that I can change providers without migrating my memories

  Scenario: The OpenAI-compatible provider is displayed without its secret
    Given the assistant is configured with an OpenAI-compatible provider
    Then the provider name should be "openai-compatible"
    And the settings response should not include an API key

  Scenario: The memory store remains usable without a configured provider
    Given no language model provider is configured
    When a memory with category "hiking" and content "User carries a headlamp" is created
    Then exactly one memory should be stored
