import { Plugin, Stack } from '../../core/types.js';
import { PluginRegistry } from '../../core/registry.js';

import { methodLengthCheck, namingConventionsCheck }         from './checks/readability.js';
import { controllerBloatCheck, serviceLayerCheck, cyclomaticComplexityCheck, duplicateCodeCheck } from './checks/maintainability.js';
import { interfaceUsageCheck, repositoryPatternCheck, configUsageCheck }      from './checks/extensibility.js';
import { testFrameworkCheck, testFileRatioCheck, assertionDensityCheck, testTypeBalanceCheck } from './checks/test-coverage.js';
import { hardcodedSecretsCheck, sqlInjectionCheck, envExposureCheck, massAssignmentCheck } from './checks/security.js';
import { nPlusOneCheck, cacheUsageCheck, eagerLoadingCheck }                  from './checks/performance.js';
import { readmeCheck, phpDocCoverageCheck, changelogCheck }                   from './checks/documentation.js';
import { mvcStructureCheck, middlewareCheck, separationOfConcernsCheck }      from './checks/architecture.js';

const phpLaravelPlugin: Plugin = {
  id: 'php-laravel',
  stacks: [Stack.PhpLaravel],
  checks: [
    // Readability
    methodLengthCheck,
    namingConventionsCheck,
    // Maintainability
    controllerBloatCheck,
    serviceLayerCheck,
    cyclomaticComplexityCheck,
    duplicateCodeCheck,
    // Extensibility
    interfaceUsageCheck,
    repositoryPatternCheck,
    configUsageCheck,
    // Test Coverage
    testFrameworkCheck,
    testFileRatioCheck,
    assertionDensityCheck,
    testTypeBalanceCheck,
    // Security
    hardcodedSecretsCheck,
    sqlInjectionCheck,
    envExposureCheck,
    massAssignmentCheck,
    // Performance
    nPlusOneCheck,
    cacheUsageCheck,
    eagerLoadingCheck,
    // Documentation
    readmeCheck,
    phpDocCoverageCheck,
    changelogCheck,
    // Architecture
    mvcStructureCheck,
    middlewareCheck,
    separationOfConcernsCheck,
  ],
};

PluginRegistry.register(phpLaravelPlugin);
