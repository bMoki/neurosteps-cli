// Test setup: ensure env vars are set before env.ts is imported
// Using real values so filesystem-dependent tests work correctly
process.env.NS_PRODUCT_NAME = process.env.NS_PRODUCT_NAME || "neurosteps";
process.env.NS_BACKEND_MODULE = process.env.NS_BACKEND_MODULE || "scalemed";
process.env.NS_BACKEND_REPO_NAME = process.env.NS_BACKEND_REPO_NAME || "scalemed-backend";
process.env.NS_MANAGER_REPO_NAME = process.env.NS_MANAGER_REPO_NAME || "neurosteps-manager";
process.env.NS_SEED_VOLUME = process.env.NS_SEED_VOLUME || "scalemed-backend_neurosteps_bd_volume";
