/**
 * Model Validation - Ensure model and code are in sync
 * 
 * This script validates that:
 * 1. Model input shape matches current feature count
 * 2. Normalization params match current feature count
 * 3. Feature names in normalization match current definitions
 */

const fs = require('fs');
const path = require('path');
const { getFeatureCount, getFeatureNames, validateNormalization } = require('./features');

/**
 * Validate model files are compatible with current code
 * @param {string} modelDir - Path to model directory
 * @returns {Object} Validation result {valid: boolean, errors: Array<string>, warnings: Array<string>}
 */
function validateModel(modelDir) {
  const errors = [];
  const warnings = [];
  
  const normPath = path.join(modelDir, 'normalization.json');
  const modelJsonPath = path.join(modelDir, 'model.json');
  const metricsPath = path.join(modelDir, 'metrics.json');
  
  // Check if files exist
  if (!fs.existsSync(normPath)) {
    errors.push('Missing normalization.json - model not trained yet?');
    return { valid: false, errors, warnings };
  }
  
  if (!fs.existsSync(modelJsonPath)) {
    errors.push('Missing model.json - model not trained yet?');
    return { valid: false, errors, warnings };
  }
  
  // Load normalization
  let norm;
  try {
    norm = JSON.parse(fs.readFileSync(normPath, 'utf8'));
  } catch (err) {
    errors.push(`Failed to parse normalization.json: ${err.message}`);
    return { valid: false, errors, warnings };
  }
  
  // Validate normalization
  try {
    validateNormalization(norm, 'Model validation');
  } catch (err) {
    errors.push(err.message);
  }
  
  // Check feature names match
  const currentFeatures = getFeatureNames();
  const modelFeatures = norm.featureNames || [];
  
  if (modelFeatures.length === 0) {
    warnings.push('Normalization file missing featureNames array');
  } else if (modelFeatures.length !== currentFeatures.length) {
    errors.push(
      `Feature count mismatch:\n` +
      `  Code expects: ${currentFeatures.length} features\n` +
      `  Model has: ${modelFeatures.length} features\n` +
      `  Solution: Run 'npm run train' to retrain the model`
    );
  } else {
    // Check each feature name matches
    for (let i = 0; i < currentFeatures.length; i++) {
      if (currentFeatures[i] !== modelFeatures[i]) {
        errors.push(
          `Feature name mismatch at index ${i}:\n` +
          `  Code expects: ${currentFeatures[i]}\n` +
          `  Model has: ${modelFeatures[i]}\n` +
          `  Solution: Run 'npm run train' to retrain the model`
        );
        break; // Only show first mismatch
      }
    }
  }
  
  // Load and check model.json
  let modelJson;
  try {
    modelJson = JSON.parse(fs.readFileSync(modelJsonPath, 'utf8'));
  } catch (err) {
    errors.push(`Failed to parse model.json: ${err.message}`);
    return { valid: false, errors, warnings };
  }
  
  // Check model input shape
  if (modelJson.modelTopology && modelJson.modelTopology.model_config) {
    const layers = modelJson.modelTopology.model_config.config?.layers || [];
    if (layers.length > 0) {
      const inputLayer = layers[0];
      const inputShape = inputLayer.config?.batch_input_shape;
      
      if (inputShape && inputShape.length >= 2) {
        const modelInputSize = inputShape[1];
        const expectedSize = getFeatureCount();
        
        if (modelInputSize !== expectedSize) {
          errors.push(
            `Model input shape mismatch:\n` +
            `  Code expects: ${expectedSize} features\n` +
            `  Model expects: ${modelInputSize} features\n` +
            `  Solution: Run 'npm run train' to retrain the model`
          );
        }
      }
    }
  }
  
  // Check metrics file for additional info
  if (fs.existsSync(metricsPath)) {
    try {
      const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
      
      if (metrics.featureNames && metrics.featureNames.length !== currentFeatures.length) {
        warnings.push(
          `Metrics file shows ${metrics.featureNames.length} features, ` +
          `but code expects ${currentFeatures.length}`
        );
      }
      
      // Show model info
      if (metrics.trainedAt) {
        warnings.push(`Model last trained: ${metrics.trainedAt}`);
      }
      if (metrics.validation && metrics.validation.accuracy) {
        warnings.push(`Model validation accuracy: ${(metrics.validation.accuracy * 100).toFixed(1)}%`);
      }
    } catch (err) {
      // Metrics file is optional, don't fail
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validate and throw error if invalid
 * Use this at server startup to fail fast
 */
function validateModelOrThrow(modelDir) {
  const result = validateModel(modelDir);
  
  if (result.warnings.length > 0) {
    console.log('\n⚠️  Model Validation Warnings:');
    result.warnings.forEach(w => console.log(`   ${w}`));
  }
  
  if (!result.valid) {
    console.error('\n❌ MODEL VALIDATION FAILED:\n');
    result.errors.forEach(e => console.error(`   ${e}\n`));
    throw new Error('Model validation failed - please retrain the model');
  }
  
  console.log('✅ Model validation passed');
  return true;
}

module.exports = {
  validateModel,
  validateModelOrThrow
};
