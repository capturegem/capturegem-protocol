import { expect } from "chai";
import { Keypair, SystemProgram } from "@solana/web3.js";
import {
  program,
  user,
  performer,
  moderator,
  setupAccounts,
  getModTicketPDA,
  getModeratorStakePDA,
  getGlobalStatePDA,
} from "./helpers/setup";
import { TARGET_ID, REASON } from "./helpers/constants";

describe("Moderation", () => {
  let globalStatePDA: any;
  let moderatorStakePDA: any;

  before(async () => {
    await setupAccounts();
    [globalStatePDA] = getGlobalStatePDA();
    [moderatorStakePDA] = getModeratorStakePDA(moderator.publicKey);
  });

  describe("Create Ticket", () => {
    it("Successfully creates ContentReport ticket", async () => {
      const [ticketPDA] = getModTicketPDA(TARGET_ID);

      const tx = await program.methods
        .createTicket(
          TARGET_ID,
          { contentReport: {} },
          REASON
        )
        .accounts({
          reporter: user.publicKey,
          ticket: ticketPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      const ticket = await program.account.modTicket.fetch(ticketPDA);
      expect(ticket.reporter.toString()).to.equal(user.publicKey.toString());
      expect(ticket.targetId).to.equal(TARGET_ID);
      expect(ticket.reason).to.equal(REASON);
      expect(ticket.resolved).to.be.false;
    });

    it("Successfully creates DuplicateReport ticket", async () => {
      const [ticketPDA] = getModTicketPDA("target-2");

      const tx = await program.methods
        .createTicket(
          "target-2",
          { duplicateReport: {} },
          REASON
        )
        .accounts({
          reporter: user.publicKey,
          ticket: ticketPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      const ticket = await program.account.modTicket.fetch(ticketPDA);
      expect(ticket.targetId).to.equal("target-2");
    });

    it("Successfully creates PerformerClaim ticket", async () => {
      const [ticketPDA] = getModTicketPDA("target-3");

      const tx = await program.methods
        .createTicket(
          "target-3",
          { performerClaim: {} },
          REASON
        )
        .accounts({
          reporter: performer.publicKey,
          ticket: ticketPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([performer])
        .rpc();

      const ticket = await program.account.modTicket.fetch(ticketPDA);
      expect(ticket.targetId).to.equal("target-3");
    });

    it("Fails if target_id exceeds MAX_ID_LEN", async () => {
      const longTargetId = "a".repeat(33); // MAX_ID_LEN is 32
      const [ticketPDA] = getModTicketPDA(longTargetId);

      try {
        await program.methods
          .createTicket(
            longTargetId,
            { contentReport: {} },
            REASON
          )
          .accounts({
            reporter: user.publicKey,
            ticket: ticketPDA,
            systemProgram: SystemProgram.programId,
          })
          .signers([user])
          .rpc();
        expect.fail("Should have failed");
      } catch (err: any) {
        expect(err.toString()).to.include("StringTooLong");
      }
    });

    it("Fails if reason exceeds MAX_REASON_LEN", async () => {
      const longReason = "a".repeat(201); // MAX_REASON_LEN is 200
      const [ticketPDA] = getModTicketPDA("target-4");

      try {
        await program.methods
          .createTicket(
            "target-4",
            { contentReport: {} },
            longReason
          )
          .accounts({
            reporter: user.publicKey,
            ticket: ticketPDA,
            systemProgram: SystemProgram.programId,
          })
          .signers([user])
          .rpc();
        expect.fail("Should have failed");
      } catch (err: any) {
        expect(err.toString()).to.include("StringTooLong");
      }
    });
  });

  describe("Resolve Ticket", () => {
    let ticketPDA: any;

    before(async () => {
      [ticketPDA] = getModTicketPDA(TARGET_ID);
    });

    it("Successfully resolves ticket with verdict=true", async () => {
      const tx = await program.methods
        .resolveTicket(true)
        .accounts({
          moderator: moderator.publicKey,
          globalState: globalStatePDA,
          moderatorStake: moderatorStakePDA,
          ticket: ticketPDA,
        })
        .signers([moderator])
        .rpc();

      const ticket = await program.account.modTicket.fetch(ticketPDA);
      expect(ticket.resolved).to.be.true;
      expect(ticket.verdict).to.be.true;
      expect(ticket.resolver?.toString()).to.equal(moderator.publicKey.toString());
    });

    it("Successfully resolves ticket with verdict=false", async () => {
      const [newTicketPDA] = getModTicketPDA("target-verdict-false");
      
      // Create ticket
      await program.methods
        .createTicket(
          "target-verdict-false",
          { contentReport: {} },
          REASON
        )
        .accounts({
          reporter: user.publicKey,
          ticket: newTicketPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      // Resolve with false
      await program.methods
        .resolveTicket(false)
        .accounts({
          moderator: moderator.publicKey,
          globalState: globalStatePDA,
          moderatorStake: moderatorStakePDA,
          ticket: newTicketPDA,
        })
        .signers([moderator])
        .rpc();

      const ticket = await program.account.modTicket.fetch(newTicketPDA);
      expect(ticket.resolved).to.be.true;
      expect(ticket.verdict).to.be.false;
    });

    it("Fails if ticket is already resolved", async () => {
      try {
        await program.methods
          .resolveTicket(false)
          .accounts({
            moderator: moderator.publicKey,
            globalState: globalStatePDA,
            moderatorStake: moderatorStakePDA,
            ticket: ticketPDA,
          })
          .signers([moderator])
          .rpc();
        expect.fail("Should have failed");
      } catch (err: any) {
        expect(err.toString()).to.include("TicketAlreadyResolved");
      }
    });

    it("Fails if moderator doesn't have sufficient stake", async () => {
      const [newTicketPDA] = getModTicketPDA("target-new");
      const unstakedModerator = Keypair.generate();
      const [unstakedModeratorStakePDA] = getModeratorStakePDA(unstakedModerator.publicKey);

      // Create ticket
      await program.methods
        .createTicket(
          "target-new",
          { contentReport: {} },
          REASON
        )
        .accounts({
          reporter: user.publicKey,
          ticket: newTicketPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      // Try to resolve without stake
      try {
        await program.methods
          .resolveTicket(true)
          .accounts({
            moderator: unstakedModerator.publicKey,
            globalState: globalStatePDA,
            moderatorStake: unstakedModeratorStakePDA,
            ticket: newTicketPDA,
          })
          .signers([unstakedModerator])
          .rpc();
        expect.fail("Should have failed");
      } catch (err: any) {
        expect(err.toString()).to.include("InsufficientModeratorStake");
      }
    });
  });
});
