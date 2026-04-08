const hre = require("hardhat");

async function main() {
  console.log("Deploying Voting contract...");
  
  const Voting = await hre.ethers.getContractFactory("Voting");
  const voting = await Voting.deploy();
  await voting.waitForDeployment();

  const contractAddress = await voting.getAddress();
  const [deployer] = await hre.ethers.getSigners();

  console.log("===========================================");
  console.log("✅ Voting contract deployed successfully!");
  console.log("===========================================");
  console.log("Contract address:", contractAddress);
  console.log("Deployer/admin:", deployer.address);
  console.log("Initial voting status: CLOSED");
  console.log("Initial candidates: 0");
  console.log("===========================================");
  console.log("\n📝 Next steps:");
  console.log("1. Update CONTRACT_ADDRESS in contractConfig.js to:", contractAddress);
  console.log("2. Restart your React app");
  console.log("3. Connect as admin in frontend");
  console.log("4. Add candidates (voting is closed by default)");
  console.log("5. Open voting when ready");
  console.log("===========================================");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });