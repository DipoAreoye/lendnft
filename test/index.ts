import { expect } from "chai";
import { deployments, ethers, waffle } from "hardhat";

import { BigNumber } from "ethers";
import EthersAdapter from '@gnosis.pm/safe-ethers-lib'
import { Wallet } from '@ethersproject/wallet'
import guardABI from '../abi/GuardManager.json'
import nftContractABI from '../abi/ERC721.json'

import { ContractNetworksConfig } from '@gnosis.pm/safe-core-sdk'
import Safe, { SafeFactory, SafeAccountConfig } from '@gnosis.pm/safe-core-sdk'
import { SafeSignature, SafeTransactionDataPartial } from '@gnosis.pm/safe-core-sdk-types'
import EthSignSignature from '../scripts/SafeSignature'

describe("Deploy Safe", function () {
  let safeSdk: Safe;
  let lender : Wallet;
  let borrower: Wallet;
  let tokenAddress = "0x1aAD0be6EaB3EDbDd05c05601037CC4FCd9bB944";
  let safeManagerAddress: string;
  let moduleAddress: string;
  let guardAddress: string;
  let safeAddress: string;
  let tokenId: BigNumber;

  before("Deploy Safe, Module & Mint NFT to lender address", async function() {
    console.log("heyyyyyy");

    //Deploy safe SDK dependency contracts
    const deplys = await deployments.fixture();


    const [user1, user2] = waffle.provider.getWallets();
    borrower = user1
    lender = user2

    //Deploy ZorosSafeManager
    const ZorosSafeManager = await ethers.getContractFactory("ZorosSafeManager");
    const safeManager = await ZorosSafeManager.deploy();

    await safeManager.deployed();
    safeManagerAddress = safeManager.address;

    //Mint NFT from contract
    const MyContract = await ethers.getContractFactory("BoredApeYachtClub");
    const boredApeContract = MyContract.attach(tokenAddress);

    tokenAddress = boredApeContract.address;

    const apePrice = await boredApeContract.apePrice();
    tokenId = await boredApeContract.totalSupply();
    const tx = await boredApeContract.connect(lender).mintApe(1, { value: apePrice })

    let receipt = await tx.wait();
    const transferEvent = receipt.events?.filter((x) => {return x.event == "Transfer"})

    if (transferEvent != null) {
      tokenId = BigNumber.from(transferEvent[0].topics[3])
    }

    //Deploy Safe
    const ethAdapter = new EthersAdapter({
      ethers,
      signer: borrower
    })

    const chainId = await ethAdapter.getChainId()
    const contractNetworks: ContractNetworksConfig = {
      [chainId]: {
        multiSendAddress: '0x34650C475Ac99A2aFd4fA7d5F801364f3eCC94DA',
        safeMasterCopyAddress: '0x2c383D56322fDeaa1301070cd4F8E68F0cd91180',
        safeProxyFactoryAddress: '0x3831318eF298172Cc7Aef3D816D158d46EB6963B'
      }
    }

    const safeFactory = await SafeFactory.create({ethAdapter, contractNetworks})

    const owners = [borrower.address, safeManagerAddress];
    const threshold = 1
    const safeAccountConfig: SafeAccountConfig = {
      owners,
      threshold,
    }

    safeSdk = await safeFactory.deploySafe({ safeAccountConfig })
    safeAddress = safeSdk.getAddress();

    // Deploy Module
    // const BrentModule = await ethers.getContractFactory("BrentModule");
    // const module = await BrentModule.deploy(
    //   safeAddress,
    //   tokenAddress,
    //   borrower.address,
    //   tokenId);
    //
    // await module.deployed();
    // moduleAddress = module.address;
    //
    // // Add Module to safe and confirm
    // const safeTransaction = await safeSdk.getEnableModuleTx(moduleAddress)
    //
    // await safeSdk.executeTransaction(safeTransaction)

    //Deploy Guard
    // const BrentGuard = await ethers.getContractFactory("BrentGuard");
    // const guard = await BrentGuard.deploy(
    //   tokenAddress,
    //   lender.address,
    //   tokenId,
    //   safeAddress);
    //
    // await guard.deployed();
    // guardAddress = guard.address;

    // const guardInterface = new ethers.utils.Interface(guardABI);
    // const data = guardInterface.encodeFunctionData("setGuard", [guardAddress]);
    //
    // const transaction: SafeTransactionDataPartial = {
    //   to: safeAddress,
    //   value: '0',
    //   data
    // }
    //
    // const addGuardTx = await safeSdk.createTransaction(transaction)
    // await safeSdk.executeTransaction(addGuardTx)
  })

  it("AcceptListing", async function () {
    const MyContract = await ethers.getContractFactory("BoredApeYachtClub");
    const boredApeContract = MyContract.attach(tokenAddress);

    const ZorosSafeManager = await ethers.getContractFactory("ZorosSafeManager");
    const safeManagerContract = ZorosSafeManager.attach(safeManagerAddress);

    const signatures = generatePreValidatedSignature(safeManagerAddress)
    console.log("Safe",safeAddress);

    const bytesString = ethers.utils.hexlify(signatures)
    console.log(bytesString);

    console.log("borrower", borrower.address)
    console.log("lender", lender.address)
    console.log("safeManager", safeManagerAddress)

    await safeManagerContract.connect(borrower).acceptListing(
      tokenId,
      tokenAddress,
      lender.address,
      borrower.address,
      safeAddress,
      bytesString
    );

    expect(await safeSdk.isModuleEnabled(safeManagerAddress)).to.equal(true)
  });

  it("Transfer NFT to safe", async function () {
    const MyContract = await ethers.getContractFactory("BoredApeYachtClub");
    const boredApeContract = MyContract.attach(tokenAddress);

    const balanceBefore = await boredApeContract.balanceOf(safeAddress)
    expect(balanceBefore).to.equal(BigNumber.from(0))

    const tx = await boredApeContract.connect(lender).transferFrom(lender.address,safeAddress,tokenId)

    const balanceAfter = await boredApeContract.balanceOf(safeAddress)
    expect(balanceAfter).to.equal(BigNumber.from(1))
  });

  it("Ensure guard protects NFT", async function () {
    const interace = new ethers.utils.Interface(nftContractABI);
    const data = interace.encodeFunctionData("transferFrom", [safeAddress, lender.address, tokenId]);

    const transaction: SafeTransactionDataPartial = {
      to: tokenAddress,
      value: '0',
      data
    }

    const addGuardTx = await safeSdk.createTransaction(transaction)

    await expect(safeSdk.executeTransaction(addGuardTx)).to.be.reverted
  });

  it("Ensure guard protects removing guard", async function () {
    const guardInterface = new ethers.utils.Interface(guardABI);
    const data = guardInterface.encodeFunctionData("setGuard", [ethers.constants.AddressZero]);

    const transaction: SafeTransactionDataPartial = {
      to: safeAddress,
      value: '0',
      data
    };

    const addGuardTx = await safeSdk.createTransaction(transaction);
    await expect(safeSdk.executeTransaction(addGuardTx)).to.be.reverted;
  });

  it("Ensure guard protects adding module", async function () {
    //Deploy Module
    const BrentModule = await ethers.getContractFactory("BrentModule");
    const module2 = await BrentModule.deploy(
      safeAddress,
      tokenAddress,
      borrower.address,
      tokenId);

    await module2.deployed();
    const module2Address = module2.address;

    const safeTransaction = await safeSdk.getEnableModuleTx(module2Address);
    await expect(safeSdk.executeTransaction(safeTransaction)).to.be.reverted;
  });

  it("Ensure guard protects removing module", async function () {
    const safeTransaction = await safeSdk.getDisableModuleTx(safeManagerAddress)
    await expect(safeSdk.executeTransaction(safeTransaction)).to.be.reverted;
  });

  it("Retrieve NFT from safe", async function () {
    const ZorosSafeManager = await ethers.getContractFactory("ZorosSafeManager");
    const safeManager = ZorosSafeManager.attach(safeManagerAddress);

    const MyContract = await ethers.getContractFactory("BoredApeYachtClub");
    const boredApeContract = MyContract.attach(tokenAddress);

    const balanceBefore = await boredApeContract.balanceOf(lender.address)
    expect(balanceBefore).to.equal(BigNumber.from(0))

    await safeManager.connect(lender).retrieveNFT(tokenId);

    const balance = await boredApeContract.balanceOf(lender.address)
    expect(balance).to.equal(BigNumber.from(1))
  });

  function generatePreValidatedSignature(ownerAddress: string): string {
    const signature =
      '0x000000000000000000000000' +
      ownerAddress.slice(2) +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '01'

    return new EthSignSignature(ownerAddress, signature).encodeSignature()
  }
});
