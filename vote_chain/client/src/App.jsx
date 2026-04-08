import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { CONTRACT_ADDRESS, CONTRACT_ABI } from "./contractConfig";

// Color palette for charts
const CHART_COLORS = [
  '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#ec4899', '#6366f1', '#14b8a6', '#f97316', '#84cc16'
];

function App() {
  const [walletAddress, setWalletAddress] = useState(null);
  const [contract, setContract] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [hasVoted, setHasVoted] = useState(false);
  const [votingOpen, setVotingOpen] = useState(true);
  const [status, setStatus] = useState("Connect your wallet to start voting");
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [networkName, setNetworkName] = useState("");
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [activeTab, setActiveTab] = useState("voting"); 
  const [votingHistory, setVotingHistory] = useState([]);
  
  // New states for candidate addition
  const [newCandidateName, setNewCandidateName] = useState("");
  const [showAddCandidateModal, setShowAddCandidateModal] = useState(false);
  const [isAddingCandidate, setIsAddingCandidate] = useState(false);

  const connectWallet = async () => {
    if (!window.ethereum) {
      alert("MetaMask is not installed. Please install it to continue.");
      window.open("https://metamask.io/download/", "_blank");
      return;
    }

    try {
      setIsLoading(true);
      setStatus("Requesting wallet connection...");
      
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      
      if (accounts.length === 0) {
        setStatus("No wallet connected. Please connect to MetaMask.");
        return;
      }
      
      const address = accounts[0];
      setWalletAddress(address);
      setShowConnectModal(false);

      const provider = new ethers.BrowserProvider(window.ethereum);
      const network = await provider.getNetwork();
      setNetworkName(network.name === "unknown" ? "Local Network" : network.name);
      
      const signer = await provider.getSigner();
      const contractInstance = new ethers.Contract(
        CONTRACT_ADDRESS,
        CONTRACT_ABI,
        signer
      );

      setContract(contractInstance);
      setStatus("✅ Wallet connected successfully!");

      await loadElectionData(contractInstance, address);
    } catch (err) {
      console.error(err);
      if (err.code === 4001) {
        setStatus("❌ Wallet connection rejected by user.");
      } else {
        setStatus("❌ Failed to connect wallet. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const disconnectWallet = () => {
    setWalletAddress(null);
    setContract(null);
    setCandidates([]);
    setHasVoted(false);
    setIsAdmin(false);
    setNetworkName("");
    setVotingHistory([]);
    setNewCandidateName("");
    setShowAddCandidateModal(false);
    setStatus("Wallet disconnected. Connect to start voting.");
    setActiveTab("voting");
  };

  const loadElectionData = async (contractInstance, address) => {
  try {
    setIsLoading(true);
    const count = await contractInstance.candidatesCount();
    const vOpen = await contractInstance.votingOpen();
    setVotingOpen(vOpen);

    const adminAddress = await contractInstance.admin();
    setIsAdmin(adminAddress.toLowerCase() === address.toLowerCase());

    const voted = await contractInstance.hasVoted(address);
    setHasVoted(voted);

    const list = [];
    const total = Number(count);
    
    if (total > 0) {
      try {
        const allCandidates = await contractInstance.getAllCandidates();
        allCandidates.forEach((c, i) => {
          list.push({
            id: Number(c.id),
            name: c.name,
            voteCount: Number(c.voteCount),
          });
        });
      } catch {
        for (let i = 1; i <= total; i++) {
          const c = await contractInstance.candidates(i);
          list.push({
            id: Number(c.id),
            name: c.name,
            voteCount: Number(c.voteCount),
          });
        }
      }
    }
    
    setCandidates(list);
    
    // Load real voting history
    await loadVotingHistory(); // Changed from loadVotingHistory()
  } catch (err) {
    console.error(err);
    setStatus("Error loading election data.");
  } finally {
    setIsLoading(false);
  }
};

 const loadVotingHistory = async () => {
  if (!contract) return;
  
  try {
    setIsLoading(true);
    
    // Get Voted events from the blockchain
    const filter = contract.filters.Voted();
    const events = await contract.queryFilter(filter);
    
    if (events.length === 0) {
      // No voting events yet
      setVotingHistory([]);
      return;
    }
    
    // Get current time for comparison
    const now = Date.now();
    
    // Process events in batches to avoid too many requests
    const historyPromises = events.slice(-20).reverse().map(async (event, index) => {
      try {
        const voter = event.args.voter;
        const candidateId = Number(event.args.candidateId);
        
        // Find candidate name from current candidates list
        const candidate = candidates.find(c => c.id === candidateId);
        const candidateName = candidate ? candidate.name : `Candidate #${candidateId}`;
        
        // Try to get block timestamp
        let timeAgo = "Recently";
        try {
          const block = await contract.runner.provider.getBlock(event.blockNumber);
          if (block && block.timestamp) {
            const timestamp = block.timestamp * 1000;
            timeAgo = getTimeAgo(timestamp);
          }
        } catch (timestampErr) {
          console.log("Could not get block timestamp:", timestampErr);
        }
        
        return {
          id: events.length - index,
          voter: formatAddress(voter),
          fullVoter: voter,
          candidate: candidateName,
          candidateId: candidateId,
          time: timeAgo,
          blockNumber: event.blockNumber,
          transactionHash: event.transactionHash
        };
      } catch (err) {
        console.error("Error processing event:", err);
        return null;
      }
    });
    
    const historyResults = await Promise.all(historyPromises);
    const validHistory = historyResults.filter(item => item !== null);
    
    setVotingHistory(validHistory);
    
  } catch (err) {
    console.error("Error loading voting history:", err);
    // Show message instead of simulated data
    setVotingHistory([
      { 
        id: 1, 
        voter: "Blockchain data", 
        candidate: "Loading...", 
        time: "Waiting for votes",
        status: "info"
      }
    ]);
  } finally {
    setIsLoading(false);
  }
};

const handleVote = async (candidateId) => {
  if (!contract) return;
  try {
    setIsLoading(true);
    setStatus("Processing your vote...");
    const tx = await contract.vote(candidateId);
    setStatus("Transaction sent! Waiting for confirmation...");
    await tx.wait();
    setStatus("✅ Vote recorded successfully on the blockchain!");
    
    // Refresh data including voting history
    if (walletAddress) {
      await loadElectionData(contract, walletAddress);
    }
  } catch (err) {
    console.error(err);
    setStatus("❌ Vote failed. Make sure you haven't already voted.");
  } finally {
    setIsLoading(false);
  }
};

  const toggleVoting = async (open) => {
    if (!contract) return;
    try {
      setIsLoading(true);
      setStatus(open ? "Opening voting session..." : "Closing voting session...");
      const tx = open ? await contract.openVoting() : await contract.closeVoting();
      await tx.wait();
      setStatus(open ? "✅ Voting is now OPEN!" : "✅ Voting is now CLOSED!");
      if (walletAddress) {
        await loadElectionData(contract, walletAddress);
      }
    } catch (err) {
      console.error(err);
      setStatus("❌ Failed to change voting status.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddCandidate = async () => {
    if (!contract || !newCandidateName.trim()) return;
    
    try {
      setIsAddingCandidate(true);
      setStatus("Adding candidate...");
      const tx = await contract.addCandidate(newCandidateName.trim());
      setStatus("Transaction sent! Waiting for confirmation...");
      await tx.wait();
      setStatus("✅ Candidate added successfully!");
      setNewCandidateName("");
      setShowAddCandidateModal(false);
      
      // Refresh candidate list
      if (walletAddress) {
        await loadElectionData(contract, walletAddress);
      }
    } catch (err) {
      console.error(err);
      setStatus("❌ Failed to add candidate. Make sure voting is closed.");
    } finally {
      setIsAddingCandidate(false);
    }
  };

  const formatAddress = (addr) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const checkNetwork = async () => {
    if (window.ethereum) {
      const provider = new ethers.BrowserProvider(window.ethereum);
      try {
        const network = await provider.getNetwork();
        setNetworkName(network.name === "unknown" ? "Local Network" : network.name);
      } catch (err) {
        console.error("Network check failed:", err);
      }
    }
  };

  useEffect(() => {
    if (window.ethereum) {
      checkNetwork();
      
      window.ethereum.on("accountsChanged", (accounts) => {
        if (accounts.length === 0) {
          disconnectWallet();
        } else {
          setWalletAddress(accounts[0]);
          connectWallet();
        }
      });
      
      window.ethereum.on("chainChanged", () => {
        window.location.reload();
      });
    }
  }, []);


const getTimeAgo = (timestamp) => {
  const now = Date.now();
  const diff = now - timestamp;
  
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return "Just now";
};


  // Calculate statistics for results page
  const getElectionStats = () => {
    if (candidates.length === 0) return null;
    
    const totalVotes = candidates.reduce((sum, cand) => sum + cand.voteCount, 0);
    const winner = [...candidates].sort((a, b) => b.voteCount - a.voteCount)[0];
    const votePercentages = candidates.map(c => ({
      ...c,
      percentage: totalVotes > 0 ? ((c.voteCount / totalVotes) * 100).toFixed(1) : 0
    }));
    
    return {
      totalVotes,
      winner,
      votePercentages: votePercentages.sort((a, b) => b.voteCount - a.voteCount),
      participation: totalVotes > 0 ? Math.min(totalVotes * 10, 100) : 0 // Simulated
    };
  };

  const stats = getElectionStats();

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerContent}>
          <div style={styles.logo}>
            <i className="fas fa-vote-yea" style={styles.logoIcon}></i>
            <div>
              <h1 style={styles.title}>VoteChain</h1>
              <p style={styles.subtitle}>Secure Blockchain Voting System</p>
            </div>
          </div>
          
          {/* Wallet Connection Button */}
          <div style={styles.walletSection}>
            {!walletAddress ? (
              <button 
                style={styles.connectWalletButton}
                onClick={() => setShowConnectModal(true)}
              >
                <i className="fas fa-plug" style={{marginRight: "8px"}}></i>
                Connect Wallet
              </button>
            ) : (
              <div style={styles.connectedWallet}>
                <div style={styles.walletInfo}>
                  <div style={styles.walletAddress}>
                    <i className="fas fa-wallet" style={{marginRight: "8px", color: "#10b981"}}></i>
                    {formatAddress(walletAddress)}
                  </div>
                  {networkName && (
                    <div style={styles.networkTag}>
                      <i className="fas fa-circle" style={{
                        fontSize: "8px",
                        marginRight: "6px",
                        color: networkName.includes("Local") ? "#f59e0b" : "#10b981"
                      }}></i>
                      {networkName}
                    </div>
                  )}
                </div>
                <button 
                  style={styles.disconnectButton}
                  onClick={disconnectWallet}
                  title="Disconnect Wallet"
                >
                  <i className="fas fa-sign-out-alt"></i>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Navigation Tabs */}
        {walletAddress && (
          <div style={styles.navTabs}>
            <button
              style={{
                ...styles.tabButton,
                ...(activeTab === "voting" ? styles.tabButtonActive : {})
              }}
              onClick={() => setActiveTab("voting")}
            >
              <i className="fas fa-vote-yea" style={{marginRight: "8px"}}></i>
              Voting Booth
            </button>
            <button
              style={{
                ...styles.tabButton,
                ...(activeTab === "results" ? styles.tabButtonActive : {})
              }}
              onClick={() => setActiveTab("results")}
            >
              <i className="fas fa-chart-bar" style={{marginRight: "8px"}}></i>
              Live Results
            </button>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main style={styles.main}>
        {/* Status Card */}
        <div style={styles.card}>
          <div style={{
            ...styles.statusMessage,
            backgroundColor: status.includes("✅") ? "#d1fae5" : 
                            status.includes("❌") ? "#fee2e2" : 
                            status.includes("Connect") ? "#e0f2fe" : "#fef3c7"
          }}>
            <i className={`fas ${
              status.includes("✅") ? "fa-check-circle" : 
              status.includes("❌") ? "fa-exclamation-circle" : 
              "fa-info-circle"
            }`} style={{marginRight: "10px"}}></i>
            <span>{status}</span>
          </div>

          {/* Quick Stats */}
          {walletAddress && (
            <div style={styles.quickStats}>
              <div style={styles.statCard}>
                <div style={styles.statIcon}>
                  <i className="fas fa-users"></i>
                </div>
                <div>
                  <h3 style={styles.statNumber}>{candidates.length}</h3>
                  <p style={styles.statLabel}>Candidates</p>
                </div>
              </div>
              
              <div style={styles.statCard}>
                <div style={styles.statIcon}>
                  <i className="fas fa-vote-yea"></i>
                </div>
                <div>
                  <h3 style={styles.statNumber}>
                    {candidates.reduce((sum, cand) => sum + cand.voteCount, 0)}
                  </h3>
                  <p style={styles.statLabel}>Total Votes</p>
                </div>
              </div>
              
              <div style={styles.statCard}>
                <div style={{
                  ...styles.statIcon,
                  backgroundColor: votingOpen ? "#10b981" : "#ef4444"
                }}>
                  <i className={`fas ${votingOpen ? "fa-unlock" : "fa-lock"}`}></i>
                </div>
                <div>
                  <h3 style={{
                    ...styles.statNumber,
                    color: votingOpen ? "#10b981" : "#ef4444"
                  }}>
                    {votingOpen ? "Open" : "Closed"}
                  </h3>
                  <p style={styles.statLabel}>Voting Status</p>
                </div>
              </div>
            </div>
          )}

          {/* Admin Controls */}
          {isAdmin && walletAddress && (
            <div style={styles.adminSection}>
              <h3 style={styles.sectionTitle}>
                <i className="fas fa-user-shield" style={styles.icon}></i>
                Admin Controls
              </h3>
              <div style={styles.adminActions}>
                <button
                  style={{
                    ...styles.adminButton,
                    backgroundColor: "#8b5cf6",
                    opacity: votingOpen ? 0.6 : 1,
                    cursor: votingOpen ? "not-allowed" : "pointer"
                  }}
                  onClick={() => setShowAddCandidateModal(true)}
                  disabled={votingOpen}
                >
                  <i className="fas fa-user-plus" style={{marginRight: "8px"}}></i>
                  Add Candidate
                </button>
                <button
                  style={{
                    ...styles.adminButton,
                    backgroundColor: votingOpen ? "#9ca3af" : "#10b981",
                    opacity: votingOpen ? 0.6 : 1
                  }}
                  onClick={() => toggleVoting(true)}
                  disabled={votingOpen || isLoading}
                >
                  <i className="fas fa-play" style={{marginRight: "8px"}}></i>
                  Open Voting
                </button>
                <button
                  style={{
                    ...styles.adminButton,
                    backgroundColor: !votingOpen ? "#9ca3af" : "#ef4444",
                    opacity: !votingOpen ? 0.6 : 1
                  }}
                  onClick={() => toggleVoting(false)}
                  disabled={!votingOpen || isLoading}
                >
                  <i className="fas fa-stop" style={{marginRight: "8px"}}></i>
                  Close Voting
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Tab Content */}
        {!walletAddress ? (
          // Welcome/Connect Card
          <div style={styles.welcomeCard}>
            <div style={styles.welcomeContent}>
              <i className="fas fa-vote-yea" style={styles.welcomeIcon}></i>
              <h2 style={styles.welcomeTitle}>Welcome to VoteChain</h2>
              <p style={styles.welcomeText}>
                Connect your wallet to participate in secure, transparent blockchain voting.
                Each wallet gets one vote, and all transactions are recorded immutably.
              </p>
              <button 
                style={styles.welcomeConnectButton}
                onClick={() => setShowConnectModal(true)}
              >
                <i className="fab fa-metamask" style={{marginRight: "10px", fontSize: "1.2rem"}}></i>
                Connect Wallet to Start
              </button>
              <div style={styles.features}>
                <div style={styles.feature}>
                  <i className="fas fa-shield-alt" style={styles.featureIcon}></i>
                  <span>Secure & Transparent</span>
                </div>
                <div style={styles.feature}>
                  <i className="fas fa-user-check" style={styles.featureIcon}></i>
                  <span>One Vote Per Wallet</span>
                </div>
                <div style={styles.feature}>
                  <i className="fas fa-chart-bar" style={styles.featureIcon}></i>
                  <span>Live Results</span>
                </div>
              </div>
            </div>
          </div>
        ) : activeTab === "voting" ? (
          // Voting Tab
          <div style={styles.card}>
            <div style={styles.sectionHeader}>
              <h2 style={styles.sectionTitle}>
                <i className="fas fa-vote-yea" style={styles.icon}></i>
                Cast Your Vote
              </h2>
              {hasVoted && (
                <div style={styles.votedBadge}>
                  <i className="fas fa-check-circle" style={{marginRight: "6px"}}></i>
                  You've already voted
                </div>
              )}
            </div>
            
            {candidates.length === 0 ? (
              <div style={styles.emptyState}>
                <i className="fas fa-user-friends" style={styles.emptyIcon}></i>
                <p>No candidates available</p>
                <p style={styles.emptySubtext}>
                  {isAdmin ? "Add candidates using the 'Add Candidate' button above" : "Waiting for admin to add candidates"}
                </p>
              </div>
            ) : (
              <div style={styles.candidatesGrid}>
                {candidates.map((c, index) => {
                  const totalVotes = candidates.reduce((sum, cand) => sum + cand.voteCount, 0);
                  const percentage = totalVotes > 0 ? ((c.voteCount / totalVotes) * 100).toFixed(1) : 0;
                  
                  return (
                    <div key={c.id} style={styles.candidateCard}>
                      <div style={styles.candidateHeader}>
                        <div style={{
                          ...styles.candidateAvatar,
                          backgroundColor: CHART_COLORS[index % CHART_COLORS.length]
                        }}>
                          <span style={styles.avatarText}>{c.name.charAt(0)}</span>
                        </div>
                        <div>
                          <h3 style={styles.candidateName}>{c.name}</h3>
                          <p style={styles.candidateId}>Candidate #{c.id}</p>
                        </div>
                      </div>
                      
                      
                      
                      <button
                        style={{
                          ...styles.voteButton,
                          backgroundColor: hasVoted ? "#9ca3af" : 
                                          !votingOpen ? "#9ca3af" : CHART_COLORS[index % CHART_COLORS.length],
                          cursor: hasVoted || !votingOpen ? "not-allowed" : "pointer"
                        }}
                        disabled={hasVoted || !votingOpen || isLoading}
                        onClick={() => handleVote(c.id)}
                      >
                        {isLoading ? (
                          <i className="fas fa-spinner fa-spin"></i>
                        ) : hasVoted ? (
                          <>
                            <i className="fas fa-check-circle" style={{marginRight: "8px"}}></i>
                            Already Voted
                          </>
                        ) : !votingOpen ? (
                          <>
                            <i className="fas fa-lock" style={{marginRight: "8px"}}></i>
                            Voting Closed
                          </>
                        ) : (
                          <>
                            <i className="fas fa-vote-yea" style={{marginRight: "8px"}}></i>
                            Vote for {c.name}
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          // Results Tab
          <div style={styles.resultsContainer}>
            {/* Results Header */}
            <div style={styles.card}>
              <div style={styles.resultsHeader}>
                <div>
                  <h2 style={styles.resultsTitle}>
                    <i className="fas fa-chart-bar" style={styles.icon}></i>
                    Live Election Results
                  </h2>
                  <p style={styles.resultsSubtitle}>
                    {votingOpen ? "Live voting results - Updates in real-time" : "Final election results"}
                  </p>
                </div>
                <div style={styles.resultsTime}>
                  <i className="fas fa-clock" style={{marginRight: "8px", color: "#6b7280"}}></i>
                  Last updated: Just now
                </div>
              </div>
            </div>

            {/* Results Overview */}
            {stats && (
              <div style={styles.card}>
                <h3 style={styles.sectionTitle}>
                  <i className="fas fa-trophy" style={styles.icon}></i>
                  Election Overview
                </h3>
                <div style={styles.overviewGrid}>
                  <div style={styles.overviewCard}>
                    <div style={styles.overviewIcon}>
                      <i className="fas fa-users"></i>
                    </div>
                    <div>
                      <h4 style={styles.overviewNumber}>{stats.totalVotes}</h4>
                      <p style={styles.overviewLabel}>Total Votes Cast</p>
                    </div>
                  </div>
                  
                  <div style={styles.overviewCard}>
                    <div style={styles.overviewIcon}>
                      <i className="fas fa-percentage"></i>
                    </div>
                    <div>
                      <h4 style={styles.overviewNumber}>{stats.participation}%</h4>
                      <p style={styles.overviewLabel}>Voter Participation</p>
                    </div>
                  </div>
                  
                  {stats.winner && (
                    <div style={{
                      ...styles.overviewCard,
                      backgroundColor: "#f0f9ff",
                      border: "2px solid #bae6fd"
                    }}>
                      <div style={{
                        ...styles.overviewIcon,
                        backgroundColor: "#f59e0b",
                        animation: "pulse 2s infinite"
                      }}>
                        <i className="fas fa-crown"></i>
                      </div>
                      <div>
                        <h4 style={styles.overviewNumber}>{stats.winner.name}</h4>
                        <p style={styles.overviewLabel}>
                          Current Leader • {stats.winner.voteCount} votes
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Results Charts */}
            <div style={styles.card}>
              <h3 style={styles.sectionTitle}>
                <i className="fas fa-chart-pie" style={styles.icon}></i>
                Vote Distribution
              </h3>
              <div style={styles.chartsGrid}>
                <div style={styles.chartContainer}>
                  <div style={styles.chartHeader}>
                    <h4>Results by Candidate</h4>
                    <div style={styles.chartLegend}>
                      <span style={styles.legendItem}>
                        <i className="fas fa-square" style={{color: "#8b5cf6", marginRight: "5px"}}></i>
                        Votes
                      </span>
                    </div>
                  </div>
                  
                  <div style={styles.barChart}>
                    {stats && stats.votePercentages.map((c, index) => (
                      <div key={c.id} style={styles.barChartItem}>
                        <div style={styles.barInfo}>
                          <div style={styles.barLabel}>
                            <div style={{
                              ...styles.barColorDot,
                              backgroundColor: CHART_COLORS[index % CHART_COLORS.length]
                            }}></div>
                            <span style={styles.barName}>{c.name}</span>
                          </div>
                          <div style={styles.barNumbers}>
                            <span style={styles.barVotes}>{c.voteCount} votes</span>
                            <span style={styles.barPercentage}>{c.percentage}%</span>
                          </div>
                        </div>
                        <div style={styles.barTrack}>
                          <div 
                            style={{
                              ...styles.barFill,
                              width: `${c.percentage}%`,
                              backgroundColor: CHART_COLORS[index % CHART_COLORS.length],
                              animation: "barFill 1.5s ease-out"
                            }}
                          ></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                
                <div style={styles.chartContainer}>
  <div style={styles.chartHeader}>
    <h4>Vote Breakdown</h4>
  </div>
  
  {/* Fixed Pie Chart Container */}
  <div style={{
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    margin: "20px 0"
  }}>
    {/* Simple visualization */}
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "30px",
      flexWrap: "wrap"
    }}>
      {/* Color blocks showing distribution */}
      <div style={{
        display: "flex",
        width: "200px",
        height: "200px",
        borderRadius: "50%",
        overflow: "hidden",
        transform: "rotate(-90deg)"
      }}>
        {stats && stats.votePercentages.map((c, index) => (
          <div 
            key={c.id}
            style={{
              flex: parseFloat(c.percentage) || 0.1,
              backgroundColor: CHART_COLORS[index % CHART_COLORS.length]
            }}
            title={`${c.name}: ${c.percentage}%`}
          ></div>
        ))}
      </div>
      
      {/* Legend */}
      <div style={{
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        minWidth: "150px"
      }}>
        {stats && stats.votePercentages.map((c, index) => (
          <div key={c.id} style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "8px 12px",
            backgroundColor: "white",
            borderRadius: "8px",
            border: "1px solid #e5e7eb"
          }}>
            <div style={{
              width: "12px",
              height: "12px",
              borderRadius: "3px",
              backgroundColor: CHART_COLORS[index % CHART_COLORS.length]
            }}></div>
            <span style={{flex: 1, fontSize: "0.9rem", color: "#1f2937"}}>{c.name}</span>
            <span style={{fontWeight: "600", color: "#1f2937"}}>{c.percentage}%</span>
          </div>
        ))}
      </div>
    </div>
  </div>
</div>
              </div>
            </div>

            {/* Voting History */}
            <div style={styles.card}>
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px" }}>
    <h3 style={styles.sectionTitle}>
      <i className="fas fa-history" style={styles.icon}></i>
      Recent Voting Activity
    </h3>
    <button 
      style={styles.refreshButton}
      onClick={loadVotingHistory}
      title="Refresh voting history"
    >
      <i className="fas fa-sync-alt"></i>
    </button>
  </div>
              <div style={styles.historyTable}>
                <div style={styles.tableHeader}>
                  <div style={styles.tableHeaderCell}>Voter Address</div>
                  <div style={styles.tableHeaderCell}>Candidate</div>
                  <div style={styles.tableHeaderCell}>Time</div>
                  <div style={styles.tableHeaderCell}>Status</div>
                </div>
                {votingHistory.map((vote) => (
                  <div key={vote.id} style={styles.tableRow}>
                    <div style={styles.tableCell}>
                      <i className="fas fa-user-circle" style={{marginRight: "8px", color: "#6b7280"}}></i>
                      {vote.voter}
                    </div>
                    <div style={styles.tableCell}>
                      <div style={{
                        ...styles.candidateTag,
                        backgroundColor: CHART_COLORS[parseInt(vote.candidate) % CHART_COLORS.length] || "#8b5cf6"
                      }}>
                        {vote.candidate}
                      </div>
                    </div>
                    <div style={styles.tableCell}>
                      <i className="fas fa-clock" style={{marginRight: "8px", color: "#6b7280"}}></i>
                      {vote.time}
                    </div>
                    <div style={styles.tableCell}>
                      <span style={styles.statusBadge}>
                        <i className="fas fa-check-circle" style={{marginRight: "5px"}}></i>
                        Confirmed
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {votingHistory.length === 0 && (
                <div style={styles.emptyHistory}>
                  <i className="fas fa-history" style={styles.emptyHistoryIcon}></i>
                  <p>No voting activity yet</p>
                </div>
              )}
            </div>

            {/* Results Summary */}
            <div style={styles.card}>
              <h3 style={styles.sectionTitle}>
                <i className="fas fa-file-alt" style={styles.icon}></i>
                Results Summary
              </h3>
              <div style={styles.summaryGrid}>
                {stats && stats.votePercentages.slice(0, 3).map((c, index) => (
                  <div key={c.id} style={styles.summaryCard}>
                    <div style={styles.rankBadge}>
                      #{index + 1}
                    </div>
                    <div style={styles.summaryCandidate}>
                      <div style={{
                        ...styles.summaryAvatar,
                        backgroundColor: CHART_COLORS[index % CHART_COLORS.length]
                      }}>
                        <span style={styles.summaryAvatarText}>{c.name.charAt(0)}</span>
                      </div>
                      <div>
                        <h4 style={styles.summaryName}>{c.name}</h4>
                        <p style={styles.summaryVotes}>{c.voteCount} votes</p>
                      </div>
                    </div>
                    <div style={styles.summaryStats}>
                      <div style={styles.statItem}>
                        <span style={styles.statLabel}>Percentage:</span>
                        <span style={styles.statValue}>{c.percentage}%</span>
                      </div>
                      <div style={styles.statItem}>
                        <span style={styles.statLabel}>Candidate ID:</span>
                        <span style={styles.statValue}>#{c.id}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Info Footer */}
        <div style={styles.infoFooter}>
          <p style={styles.infoText}>
            <i className="fas fa-info-circle" style={{marginRight: "8px"}}></i>
            This dApp runs on a local Hardhat blockchain. No real ETH is used for transactions.
          </p>
          {walletAddress && (
            <div style={styles.footerLinks}>
              <button 
                style={styles.footerLink}
                onClick={() => window.open("https://etherscan.io/", "_blank")}
              >
                <i className="fas fa-external-link-alt" style={{marginRight: "6px"}}></i>
                View on Etherscan
              </button>
              <button 
                style={styles.footerLink}
                onClick={() => window.open("https://github.com/", "_blank")}
              >
                <i className="fab fa-github" style={{marginRight: "6px"}}></i>
                Source Code
              </button>
            </div>
          )}
        </div>
      </main>

      {/* Connect Wallet Modal */}
      {showConnectModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>Connect Wallet</h2>
              <button 
                style={styles.modalClose}
                onClick={() => setShowConnectModal(false)}
              >
                <i className="fas fa-times"></i>
              </button>
            </div>
            
            <div style={styles.modalContent}>
              <p style={styles.modalText}>
                Connect your MetaMask wallet to interact with the voting system.
              </p>
              
              <button 
                style={styles.metamaskButton}
                onClick={connectWallet}
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <i className="fas fa-spinner fa-spin" style={{marginRight: "10px"}}></i>
                    Connecting...
                  </>
                ) : (
                  <>
                    <i className="fab fa-metamask" style={{marginRight: "10px", fontSize: "1.5rem"}}></i>
                    <div>
                      <div style={{fontWeight: "600"}}>Connect with MetaMask</div>
                      <div style={{fontSize: "0.9rem", opacity: 0.8}}>Most popular Ethereum wallet</div>
                    </div>
                  </>
                )}
              </button>
              
              {!window.ethereum && (
                <div style={styles.installMetaMask}>
                  <p style={{color: "#ef4444", marginBottom: "10px"}}>
                    <i className="fas fa-exclamation-triangle" style={{marginRight: "8px"}}></i>
                    MetaMask not detected
                  </p>
                  <button 
                    style={styles.installButton}
                    onClick={() => window.open("https://metamask.io/download/", "_blank")}
                  >
                    <i className="fas fa-download" style={{marginRight: "8px"}}></i>
                    Install MetaMask
                  </button>
                </div>
              )}
              
              <div style={styles.modalFooter}>
                <p style={styles.disclaimer}>
                  By connecting your wallet, you agree to our Terms of Service and Privacy Policy.
                  No real funds are required for this demo.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Candidate Modal */}
      {showAddCandidateModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>Add New Candidate</h2>
              <button 
                style={styles.modalClose}
                onClick={() => {
                  setShowAddCandidateModal(false);
                  setNewCandidateName("");
                }}
              >
                <i className="fas fa-times"></i>
              </button>
            </div>
            
            <div style={styles.modalContent}>
              <p style={styles.modalText}>
                Enter the name of the new candidate. Note: You can only add candidates when voting is closed.
              </p>
              
              <div style={styles.inputGroup}>
                <label style={styles.inputLabel}>Candidate Name</label>
                <input
                  type="text"
                  value={newCandidateName}
                  onChange={(e) => setNewCandidateName(e.target.value)}
                  placeholder="Enter candidate name"
                  style={styles.textInput}
                  disabled={votingOpen}
                />
                {votingOpen && (
                  <p style={styles.warningText}>
                    <i className="fas fa-exclamation-triangle" style={{marginRight: "8px"}}></i>
                    Voting must be closed to add candidates
                  </p>
                )}
              </div>
              
              <div style={styles.modalActions}>
                <button
                  style={{
                    ...styles.secondaryButton,
                    marginRight: "10px"
                  }}
                  onClick={() => {
                    setShowAddCandidateModal(false);
                    setNewCandidateName("");
                  }}
                  disabled={isAddingCandidate}
                >
                  Cancel
                </button>
                <button
                  style={{
                    ...styles.primaryButton,
                    opacity: !newCandidateName.trim() || votingOpen ? 0.6 : 1,
                    cursor: !newCandidateName.trim() || votingOpen ? "not-allowed" : "pointer"
                  }}
                  onClick={handleAddCandidate}
                  disabled={!newCandidateName.trim() || votingOpen || isAddingCandidate}
                >
                  {isAddingCandidate ? (
                    <>
                      <i className="fas fa-spinner fa-spin" style={{marginRight: "8px"}}></i>
                      Adding...
                    </>
                  ) : (
                    <>
                      <i className="fas fa-user-plus" style={{marginRight: "8px"}}></i>
                      Add Candidate
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Loading Overlay */}
      {isLoading && (
        <div style={styles.loadingOverlay}>
          <div style={styles.loadingContent}>
            <i className="fas fa-spinner fa-spin fa-2x" style={{color: "#8b5cf6", marginBottom: "20px"}}></i>
            <p>Processing transaction...</p>
            <p style={styles.loadingSubtext}>Please confirm in MetaMask if prompted</p>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    minHeight: "100vh",
    padding: "20px",
    maxWidth: "1200px",
    margin: "0 auto",
  },
  header: {
    marginBottom: "30px",
  },
  headerContent: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "20px",
  },
  logo: {
    display: "flex",
    alignItems: "center",
    gap: "15px",
  },
  logoIcon: {
    fontSize: "2.5rem",
    color: "#8b5cf6",
  },
  title: {
    fontSize: "2rem",
    background: "linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    margin: 0,
  },
  subtitle: {
    color: "#6b7280",
    fontSize: "0.9rem",
    marginTop: "5px",
  },
  walletSection: {
    position: "relative",
  },
  connectWalletButton: {
    padding: "12px 24px",
    borderRadius: "12px",
    border: "2px solid #8b5cf6",
    backgroundColor: "white",
    color: "#8b5cf6",
    cursor: "pointer",
    fontSize: "1rem",
    fontWeight: "600",
    display: "flex",
    alignItems: "center",
    transition: "all 0.2s ease",
  },
  connectedWallet: {
    display: "flex",
    alignItems: "center",
    gap: "15px",
    backgroundColor: "white",
    padding: "10px 20px",
    borderRadius: "12px",
    border: "1px solid #e5e7eb",
    boxShadow: "0 2px 10px rgba(0,0,0,0.05)",
  },
  walletInfo: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
  },
  walletAddress: {
    fontFamily: "monospace",
    fontWeight: "600",
    color: "#1f2937",
    marginBottom: "4px",
  },
  networkTag: {
    fontSize: "0.8rem",
    color: "#6b7280",
    display: "flex",
    alignItems: "center",
  },
  disconnectButton: {
    background: "none",
    border: "1px solid #e5e7eb",
    color: "#9ca3af",
    borderRadius: "8px",
    padding: "8px 12px",
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  navTabs: {
    display: "flex",
    gap: "10px",
    background: "white",
    padding: "10px",
    borderRadius: "12px",
    border: "1px solid #e5e7eb",
    boxShadow: "0 2px 10px rgba(0,0,0,0.05)",
  },
  tabButton: {
    padding: "12px 24px",
    borderRadius: "8px",
    border: "none",
    backgroundColor: "transparent",
    color: "#6b7280",
    cursor: "pointer",
    fontSize: "0.95rem",
    fontWeight: "500",
    display: "flex",
    alignItems: "center",
    transition: "all 0.2s ease",
  },
  tabButtonActive: {
    backgroundColor: "#8b5cf6",
    color: "white",
    boxShadow: "0 2px 8px rgba(139, 92, 246, 0.3)",
  },
  main: {
    marginTop: "20px",
  },
  card: {
    background: "white",
    borderRadius: "16px",
    padding: "25px",
    marginBottom: "20px",
    boxShadow: "0 4px 20px rgba(0, 0, 0, 0.08)",
    border: "1px solid #e5e7eb",
  },
  statusMessage: {
    padding: "15px 20px",
    borderRadius: "10px",
    marginBottom: "25px",
    display: "flex",
    alignItems: "center",
    fontSize: "0.95rem",
  },
  quickStats: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "15px",
    marginBottom: "20px",
  },
  statCard: {
    display: "flex",
    alignItems: "center",
    gap: "15px",
    padding: "15px",
    backgroundColor: "#f8fafc",
    borderRadius: "12px",
    border: "1px solid #e5e7eb",
  },
  statIcon: {
    width: "45px",
    height: "45px",
    borderRadius: "10px",
    backgroundColor: "#8b5cf6",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "white",
    fontSize: "1.1rem",
  },
  statNumber: {
    fontSize: "1.5rem",
    fontWeight: "700",
    margin: "0 0 5px 0",
    color: "#1f2937",
  },
  statLabel: {
    margin: 0,
    color: "#6b7280",
    fontSize: "0.85rem",
  },
  adminSection: {
    padding: "20px",
    backgroundColor: "#f0f9ff",
    borderRadius: "12px",
    border: "1px solid #bae6fd",
  },
  sectionTitle: {
    display: "flex",
    alignItems: "center",
    marginBottom: "15px",
    color: "#1f2937",
    fontSize: "1.3rem",
  },
  icon: {
    marginRight: "12px",
    color: "#8b5cf6",
  },
  adminActions: {
    display: "flex",
    gap: "15px",
    flexWrap: "wrap",
  },
  adminButton: {
    padding: "12px 25px",
    borderRadius: "10px",
    border: "none",
    color: "white",
    cursor: "pointer",
    fontSize: "0.95rem",
    fontWeight: "500",
    display: "flex",
    alignItems: "center",
    transition: "all 0.2s ease",
  },
  sectionHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "25px",
  },
  votedBadge: {
    backgroundColor: "#d1fae5",
    color: "#065f46",
    padding: "8px 16px",
    borderRadius: "20px",
    fontSize: "0.9rem",
    display: "flex",
    alignItems: "center",
  },
  candidatesGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
    gap: "20px",
  },
  candidateCard: {
    border: "1px solid #e5e7eb",
    borderRadius: "12px",
    padding: "20px",
    transition: "all 0.2s ease",
    backgroundColor: "#fafafa",
    display: "flex",
    flexDirection: "column",
    gap: "15px",
  },
  candidateHeader: {
    display: "flex",
    alignItems: "center",
    gap: "15px",
  },
  candidateAvatar: {
    width: "50px",
    height: "50px",
    borderRadius: "10px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "white",
    fontSize: "1.3rem",
    fontWeight: "600",
  },
  avatarText: {
    color: "white",
  },
  candidateName: {
    margin: "0 0 5px 0",
    color: "#1f2937",
    fontSize: "1.2rem",
  },
  candidateId: {
    margin: 0,
    color: "#6b7280",
    fontSize: "0.9rem",
  },
  votePreview: {
    backgroundColor: "white",
    padding: "15px",
    borderRadius: "8px",
    border: "1px solid #f3f4f6",
  },
  voteCount: {
    display: "flex",
    alignItems: "center",
    marginBottom: "10px",
    fontSize: "1rem",
  },
  voteNumber: {
    fontWeight: "700",
    color: "#1f2937",
    marginRight: "5px",
  },
  voteLabel: {
    color: "#6b7280",
  },
  previewBar: {
    height: "6px",
    backgroundColor: "#e5e7eb",
    borderRadius: "3px",
    marginBottom: "8px",
    overflow: "hidden",
  },
  previewFill: {
    height: "100%",
    borderRadius: "3px",
    transition: "width 0.5s ease",
  },
  previewPercentage: {
    margin: 0,
    color: "#6b7280",
    fontSize: "0.85rem",
    textAlign: "right",
  },
  voteButton: {
    padding: "12px 20px",
    borderRadius: "8px",
    border: "none",
    color: "white",
    cursor: "pointer",
    fontSize: "0.95rem",
    fontWeight: "500",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    transition: "all 0.2s ease",
  },
  welcomeCard: {
    background: "white",
    borderRadius: "16px",
    padding: "60px 40px",
    marginBottom: "25px",
    boxShadow: "0 4px 20px rgba(0, 0, 0, 0.08)",
    border: "2px dashed #e5e7eb",
    textAlign: "center",
  },
  welcomeContent: {
    maxWidth: "500px",
    margin: "0 auto",
  },
  welcomeIcon: {
    fontSize: "3rem",
    color: "#8b5cf6",
    marginBottom: "20px",
  },
  welcomeTitle: {
    fontSize: "1.8rem",
    color: "#1f2937",
    marginBottom: "15px",
  },
  welcomeText: {
    color: "#6b7280",
    lineHeight: "1.6",
    marginBottom: "30px",
  },
  welcomeConnectButton: {
    padding: "16px 32px",
    borderRadius: "12px",
    border: "none",
    background: "linear-gradient(135deg, #f97316 0%, #ea580c 100%)",
    color: "white",
    cursor: "pointer",
    fontSize: "1.1rem",
    fontWeight: "600",
    display: "inline-flex",
    alignItems: "center",
    marginBottom: "30px",
    transition: "all 0.2s ease",
  },
  features: {
    display: "flex",
    justifyContent: "center",
    gap: "30px",
    flexWrap: "wrap",
  },
  feature: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    color: "#6b7280",
    fontSize: "0.9rem",
  },
  featureIcon: {
    color: "#8b5cf6",
  },
  // Results Page Styles
  resultsContainer: {
    animation: "slideIn 0.3s ease-out",
  },
  resultsHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: "10px",
  },
  resultsTitle: {
    fontSize: "1.8rem",
    color: "#1f2937",
    marginBottom: "5px",
  },
  resultsSubtitle: {
    color: "#6b7280",
    fontSize: "0.95rem",
  },
  resultsTime: {
    display: "flex",
    alignItems: "center",
    color: "#6b7280",
    fontSize: "0.9rem",
    backgroundColor: "#f8fafc",
    padding: "8px 12px",
    borderRadius: "8px",
    border: "1px solid #e5e7eb",
  },
  overviewGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "20px",
  },
  overviewCard: {
    padding: "20px",
    backgroundColor: "#f8fafc",
    borderRadius: "12px",
    border: "1px solid #e5e7eb",
    display: "flex",
    alignItems: "center",
    gap: "15px",
  },
  overviewIcon: {
    width: "50px",
    height: "50px",
    borderRadius: "10px",
    backgroundColor: "#8b5cf6",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "white",
    fontSize: "1.2rem",
  },
  overviewNumber: {
    fontSize: "1.5rem",
    fontWeight: "700",
    margin: "0 0 5px 0",
    color: "#1f2937",
  },
  overviewLabel: {
    margin: 0,
    color: "#6b7280",
    fontSize: "0.9rem",
  },
  chartsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
    gap: "30px",
    marginTop: "20px",
  },
  chartContainer: {
    backgroundColor: "#f8fafc",
    padding: "20px",
    borderRadius: "12px",
    border: "1px solid #e5e7eb",
  },
  chartHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "20px",
  },
  chartLegend: {
    display: "flex",
    gap: "15px",
  },
  legendItem: {
    display: "flex",
    alignItems: "center",
    fontSize: "0.85rem",
    color: "#6b7280",
  },
  barChart: {
    display: "flex",
    flexDirection: "column",
    gap: "15px",
  },
  barChartItem: {
    animation: "slideIn 0.5s ease-out",
    animationFillMode: "backwards",
  },
  barInfo: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "8px",
  },
  barLabel: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  barColorDot: {
    width: "12px",
    height: "12px",
    borderRadius: "50%",
  },
  barName: {
    fontWeight: "500",
    color: "#1f2937",
  },
  barNumbers: {
    display: "flex",
    gap: "15px",
    fontSize: "0.9rem",
  },
  barVotes: {
    color: "#6b7280",
  },
  barPercentage: {
    fontWeight: "600",
    color: "#1f2937",
    minWidth: "40px",
    textAlign: "right",
  },
  barTrack: {
    height: "10px",
    backgroundColor: "#e5e7eb",
    borderRadius: "5px",
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: "5px",
  },
  donutChart: {
    display: "flex",
    height: "200px",
    borderRadius: "50%",
    overflow: "hidden",
    margin: "20px auto",
    position: "relative",
    width: "200px",
  },
  donutSegment: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
  },
  donutSegmentInner: {
    flex: 1,
    transition: "all 0.5s ease",
  },
  donutLegend: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    marginTop: "20px",
  },
  donutLegendItem: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "8px 12px",
    backgroundColor: "white",
    borderRadius: "6px",
    border: "1px solid #e5e7eb",
  },
  legendColor: {
    width: "12px",
    height: "12px",
    borderRadius: "3px",
  },
  legendName: {
    flex: 1,
    fontSize: "0.9rem",
    color: "#1f2937",
  },
  legendPercentage: {
    fontWeight: "600",
    color: "#1f2937",
  },
  historyTable: {
    backgroundColor: "#f8fafc",
    borderRadius: "8px",
    overflow: "hidden",
    border: "1px solid #e5e7eb",
  },
  tableHeader: {
    display: "grid",
    gridTemplateColumns: "2fr 1fr 1fr 1fr",
    backgroundColor: "#e5e7eb",
    padding: "15px 20px",
    fontWeight: "600",
    color: "#374151",
  },
  tableHeaderCell: {
    padding: "0 10px",
  },
  tableRow: {
    display: "grid",
    gridTemplateColumns: "2fr 1fr 1fr 1fr",
    padding: "15px 20px",
    borderBottom: "1px solid #e5e7eb",
    alignItems: "center",
    transition: "all 0.2s ease",
  },
  tableCell: {
    padding: "0 10px",
    display: "flex",
    alignItems: "center",
    color: "#4b5563",
  },
  candidateTag: {
    padding: "4px 12px",
    borderRadius: "15px",
    color: "white",
    fontSize: "0.85rem",
    fontWeight: "500",
  },
  statusBadge: {
    backgroundColor: "#d1fae5",
    color: "#065f46",
    padding: "4px 10px",
    borderRadius: "12px",
    fontSize: "0.85rem",
    display: "inline-flex",
    alignItems: "center",
  },
  emptyHistory: {
    textAlign: "center",
    padding: "40px 20px",
    color: "#9ca3af",
  },
  emptyHistoryIcon: {
    fontSize: "3rem",
    marginBottom: "15px",
    color: "#d1d5db",
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
    gap: "20px",
    marginTop: "20px",
  },
  summaryCard: {
    backgroundColor: "#f8fafc",
    padding: "20px",
    borderRadius: "12px",
    border: "1px solid #e5e7eb",
    position: "relative",
  },
  rankBadge: {
    position: "absolute",
    top: "-10px",
    right: "-10px",
    backgroundColor: "#f59e0b",
    color: "white",
    width: "30px",
    height: "30px",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: "600",
    fontSize: "0.9rem",
  },
  summaryCandidate: {
    display: "flex",
    alignItems: "center",
    gap: "15px",
    marginBottom: "15px",
  },
  summaryAvatar: {
    width: "50px",
    height: "50px",
    borderRadius: "10px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "white",
    fontSize: "1.2rem",
    fontWeight: "600",
  },
  summaryAvatarText: {
    color: "white",
  },
  summaryName: {
    margin: "0 0 5px 0",
    color: "#1f2937",
    fontSize: "1.2rem",
  },
  summaryVotes: {
    margin: 0,
    color: "#6b7280",
    fontSize: "0.9rem",
  },
  summaryStats: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    backgroundColor: "white",
    padding: "15px",
    borderRadius: "8px",
  },
  statItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  statLabel: {
    color: "#6b7280",
    fontSize: "0.9rem",
  },
  statValue: {
    fontWeight: "600",
    color: "#1f2937",
    fontSize: "0.95rem",
  },
  infoFooter: {
    textAlign: "center",
    padding: "20px",
    color: "#6b7280",
    fontSize: "0.9rem",
  },
  infoText: {
    margin: "0 0 15px 0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  footerLinks: {
    display: "flex",
    justifyContent: "center",
    gap: "20px",
  },
  footerLink: {
    background: "none",
    border: "none",
    color: "#8b5cf6",
    cursor: "pointer",
    fontSize: "0.9rem",
    display: "flex",
    alignItems: "center",
  },
  emptyState: {
    textAlign: "center",
    padding: "40px 20px",
    color: "#9ca3af",
  },
  emptyIcon: {
    fontSize: "3rem",
    marginBottom: "15px",
    color: "#d1d5db",
  },
  emptySubtext: {
    fontSize: "0.9rem",
    marginTop: "5px",
  },
  modalOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    backdropFilter: "blur(4px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: "20px",
  },
  modal: {
    background: "white",
    borderRadius: "16px",
    width: "100%",
    maxWidth: "450px",
    overflow: "hidden",
    boxShadow: "0 20px 60px rgba(0, 0, 0, 0.3)",
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "25px 30px",
    borderBottom: "1px solid #e5e7eb",
  },
  modalTitle: {
    margin: 0,
    color: "#1f2937",
    fontSize: "1.5rem",
  },
  modalClose: {
    background: "none",
    border: "none",
    color: "#9ca3af",
    fontSize: "1.2rem",
    cursor: "pointer",
    padding: "5px",
  },
  modalContent: {
    padding: "30px",
  },
  modalText: {
    color: "#6b7280",
    marginBottom: "25px",
    lineHeight: "1.5",
  },
  metamaskButton: {
    width: "100%",
    padding: "20px",
    borderRadius: "12px",
    border: "1px solid #e5e7eb",
    backgroundColor: "white",
    color: "#1f2937",
    cursor: "pointer",
    fontSize: "1rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
    marginBottom: "25px",
    transition: "all 0.2s ease",
  },
  installMetaMask: {
    backgroundColor: "#fef2f2",
    padding: "20px",
    borderRadius: "12px",
    marginBottom: "25px",
  },
  installButton: {
    padding: "12px 20px",
    borderRadius: "8px",
    border: "none",
    backgroundColor: "#ef4444",
    color: "white",
    cursor: "pointer",
    fontSize: "0.95rem",
    display: "flex",
    alignItems: "center",
  },
  modalFooter: {
    paddingTop: "20px",
    borderTop: "1px solid #e5e7eb",
  },
  disclaimer: {
    fontSize: "0.8rem",
    color: "#9ca3af",
    lineHeight: "1.5",
    textAlign: "center",
    margin: 0,
  },
  loadingOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    backdropFilter: "blur(4px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1001,
  },
  loadingContent: {
    textAlign: "center",
    background: "white",
    padding: "40px",
    borderRadius: "16px",
    boxShadow: "0 10px 40px rgba(0, 0, 0, 0.1)",
  },
  loadingSubtext: {
    fontSize: "0.9rem",
    color: "#6b7280",
    marginTop: "5px",
  },
  // New styles for candidate addition
  textInput: {
    width: "100%",
    padding: "12px 16px",
    borderRadius: "8px",
    border: "1px solid #d1d5db",
    fontSize: "1rem",
    marginBottom: "15px",
    boxSizing: "border-box",
  },
  inputGroup: {
    marginBottom: "20px",
  },
  inputLabel: {
    display: "block",
    marginBottom: "8px",
    fontWeight: "500",
    color: "#374151",
  },
  warningText: {
    color: "#ef4444",
    fontSize: "0.9rem",
    marginTop: "5px",
    display: "flex",
    alignItems: "center",
  },
  modalActions: {
    display: "flex",
    justifyContent: "flex-end",
    marginTop: "25px",
  },
  primaryButton: {
    padding: "12px 24px",
    borderRadius: "8px",
    border: "none",
    backgroundColor: "#8b5cf6",
    color: "white",
    cursor: "pointer",
    fontSize: "1rem",
    fontWeight: "500",
    display: "flex",
    alignItems: "center",
    transition: "all 0.2s ease",
  },
  secondaryButton: {
    padding: "12px 24px",
    borderRadius: "8px",
    border: "1px solid #d1d5db",
    backgroundColor: "white",
    color: "#374151",
    cursor: "pointer",
    fontSize: "1rem",
    fontWeight: "500",
    transition: "all 0.2s ease",

 refreshButton: {
  background: "none",
  border: "1px solid #e5e7eb",
  color: "#6b7280",
  borderRadius: "8px",
  padding: "8px 12px",
  cursor: "pointer",
  fontSize: "0.9rem",
  transition: "all 0.2s ease",
  display: "flex",
  alignItems: "center",
  gap: "5px",
},

  },
};

export default App;