import { TestCase, LogEntry } from './types';

export const MOCK_YAML_TEMPLATE = `target:
  url: "https://staging.app.example.com/login"
tasks:
  - name: "Check Login Page Elements"
    flow:
      - aiWait: "Wait for login form to be visible"
      - aiAssert: "Input field 'Username' exists"
      - aiAssert: "Input field 'Password' exists"
  - name: "Execute Login"
    flow:
      - aiInput:
          selector: "Username input"
          value: "testuser_01"
      - aiInput:
          selector: "Password input"
          value: "P@ssw0rd123"
      - aiClick: "Login Button"`;

export const MOCK_TEST_CASES: TestCase[] = [
  { id: 'TC-2024-1024', name: 'login_flow_basic.yaml', description: 'Login Test Case', status: 'pending', duration: '45s', yamlContent: MOCK_YAML_TEMPLATE },
  { id: 'TC-2024-1023', name: 'cart_checkout.yaml', description: 'Checkout Flow', status: 'pending', duration: '12s', yamlContent: MOCK_YAML_TEMPLATE.replace('Login', 'Checkout') },
  { id: 'TC-2024-1022', name: 'search_product.yaml', description: 'Search Logic', status: 'pending', duration: '28s', yamlContent: MOCK_YAML_TEMPLATE.replace('Login', 'Search') },
  { id: 'TC-2024-1021', name: 'user_profile_update.yaml', description: 'Profile Edit', status: 'pending', duration: '33s' },
  { id: 'TC-2024-1020', name: 'logout_sequence.yaml', description: 'Logout', status: 'pending', duration: '5s' },
  { id: 'TC-2024-1019', name: 'api_auth_check.yaml', description: 'API Validation', status: 'pending', duration: '8s' },
  { id: 'TC-2024-1018', name: 'homepage_hero.yaml', description: 'UI Visual Check', status: 'pending', duration: '15s' },
];

export const MOCK_LOGS: LogEntry[] = [
  { timestamp: '10:42:01', level: 'info', message: 'Initializing environment...' },
  { timestamp: '10:42:01', level: 'success', message: 'Loaded configuration from midscene.config.yaml' },
  { timestamp: '10:42:02', level: 'success', message: 'AI Engine connected successfully (DeepSeek-V3)' },
  { timestamp: '10:42:02', level: 'info', message: 'Starting Batch Execution ID: #9821' },
];
