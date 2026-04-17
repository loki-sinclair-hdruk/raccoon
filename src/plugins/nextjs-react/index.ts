import { Plugin, Stack } from '../../core/types.js';
import { PluginRegistry } from '../../core/registry.js';

import { eslintConfigCheck, componentSizeCheck }             from './checks/readability.js';
import { typescriptCheck, customHookCheck, propTypesCheck, duplicateCodeCheck } from './checks/maintainability.js';
import { fileStructureCheck, envVarUsageCheck, apiAbstractionCheck } from './checks/extensibility.js';
import { testFrameworkCheck, testFileRatioCheck, assertionDensityCheck, coverageConfigCheck } from './checks/test-coverage.js';
import { xssRiskCheck, evalUsageCheck, hardcodedSecretsCheck, securityHeadersCheck } from './checks/security.js';
import { nextImageCheck, codeSplittingCheck, memoizationCheck } from './checks/performance.js';
import { readmeCheck, jsDocCheck, storybookCheck }            from './checks/documentation.js';
import { routerConsistencyCheck, apiRoutesCheck, serverClientSeparationCheck } from './checks/architecture.js';

const nextjsReactPlugin: Plugin = {
  id: 'nextjs-react',
  stacks: [Stack.NextjsReact],
  checks: [
    // Readability
    eslintConfigCheck,
    componentSizeCheck,
    // Maintainability
    typescriptCheck,
    customHookCheck,
    propTypesCheck,
    duplicateCodeCheck,
    // Extensibility
    fileStructureCheck,
    envVarUsageCheck,
    apiAbstractionCheck,
    // Test Coverage
    testFrameworkCheck,
    testFileRatioCheck,
    assertionDensityCheck,
    coverageConfigCheck,
    // Security
    xssRiskCheck,
    evalUsageCheck,
    hardcodedSecretsCheck,
    securityHeadersCheck,
    // Performance
    nextImageCheck,
    codeSplittingCheck,
    memoizationCheck,
    // Documentation
    readmeCheck,
    jsDocCheck,
    storybookCheck,
    // Architecture
    routerConsistencyCheck,
    apiRoutesCheck,
    serverClientSeparationCheck,
  ],
};

PluginRegistry.register(nextjsReactPlugin);
