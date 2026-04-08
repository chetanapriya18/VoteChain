// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Voting {
    struct Candidate {
        uint256 id;
        string name;
        uint256 voteCount;
    }

    mapping(uint256 => Candidate) public candidates;
    uint256 public candidatesCount;

    mapping(address => bool) public hasVoted;

    address public admin;
    bool public votingOpen;

    event Voted(address indexed voter, uint256 candidateId);
    event VotingStatusChanged(bool isOpen);
    event CandidateAdded(uint256 id, string name);

    constructor() {
        admin = msg.sender;
        votingOpen = false; // Start with voting CLOSED
        candidatesCount = 0;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    function addCandidate(string memory _name) external onlyAdmin {
        require(!votingOpen, "Cannot add candidates while voting is open");
        candidatesCount++;
        candidates[candidatesCount] = Candidate(candidatesCount, _name, 0);
        emit CandidateAdded(candidatesCount, _name);
    }

    function openVoting() external onlyAdmin {
        require(candidatesCount > 0, "Need at least one candidate");
        votingOpen = true;
        emit VotingStatusChanged(true);
    }

    function closeVoting() external onlyAdmin {
        votingOpen = false;
        emit VotingStatusChanged(false);
    }

    function vote(uint256 _candidateId) external {
        require(votingOpen, "Voting is closed");
        require(!hasVoted[msg.sender], "Already voted");
        require(
            _candidateId > 0 && _candidateId <= candidatesCount,
            "Invalid candidate"
        );

        hasVoted[msg.sender] = true;
        candidates[_candidateId].voteCount++;

        emit Voted(msg.sender, _candidateId);
    }

    function getCandidate(uint256 _candidateId)
        external
        view
        returns (string memory name, uint256 voteCount)
    {
        require(
            _candidateId > 0 && _candidateId <= candidatesCount,
            "Invalid candidate"
        );

        Candidate memory c = candidates[_candidateId];
        return (c.name, c.voteCount);
    }
    
    function getAllCandidates() external view returns (Candidate[] memory) {
        Candidate[] memory allCandidates = new Candidate[](candidatesCount);
        for (uint256 i = 0; i < candidatesCount; i++) {
            allCandidates[i] = candidates[i + 1];
        }
        return allCandidates;
    }
}









