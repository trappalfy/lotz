/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/lotz.json`.
 */
export type Lotz = {
  "address": "LotzPiCxGrRhn8of391L6gPNTMnWXNwUdKyuiSoJaaa",
  "metadata": {
    "name": "lotz",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Lotz: a 1000x1000 pixel board on Solana. Lots are paid in one token; takeovers cost 1.5x and refund the previous owner; the rest is locked for a year."
  },
  "instructions": [
    {
      "name": "buy",
      "docs": [
        "Buys a rectangle of lots: free ones at the tier price, taken ones at 1.5x. Creates the ad."
      ],
      "discriminator": [
        102,
        6,
        61,
        18,
        1,
        218,
        235,
        234
      ],
      "accounts": [
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "buyerToken",
          "writable": true
        },
        {
          "name": "lockVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  99,
                  107,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "refundVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  102,
                  117,
                  110,
                  100,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "lockEpoch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104
                ]
              },
              {
                "kind": "arg",
                "path": "args.epoch"
              }
            ]
          }
        },
        {
          "name": "ad",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "buyer"
              },
              {
                "kind": "arg",
                "path": "args.nonce"
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "buyArgs"
            }
          }
        }
      ]
    },
    {
      "name": "claimRefund",
      "docs": [
        "The ad's owner takes the refunds for its lots that were taken over."
      ],
      "discriminator": [
        15,
        16,
        30,
        161,
        255,
        228,
        97,
        60
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "ad"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "ad",
          "writable": true
        },
        {
          "name": "refundVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  102,
                  117,
                  110,
                  100,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "ownerToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "closeAd",
      "docs": [
        "Closes an ad with no live lots and no refund due; the rent goes back to its owner."
      ],
      "discriminator": [
        148,
        34,
        192,
        131,
        191,
        130,
        137,
        112
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "ad"
          ]
        },
        {
          "name": "ad",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "initShard",
      "docs": [
        "Admin only. Creates shard `index` (0..100). Several fit in one transaction."
      ],
      "discriminator": [
        52,
        43,
        132,
        208,
        128,
        105,
        135,
        39
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "shard",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "index",
          "type": "u8"
        }
      ]
    },
    {
      "name": "initialize",
      "docs": [
        "Upgrade authority only, once. Creates the config and both vaults; the signer becomes the admin."
      ],
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "treasury",
          "docs": [
            "owned by the System program, which includes a multisig vault such as Squads'), never a token account or a",
            "program's PDA, because it can never be changed."
          ]
        },
        {
          "name": "lockVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  99,
                  107,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "refundVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  102,
                  117,
                  110,
                  100,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "lotzProgram",
          "address": "LotzPiCxGrRhn8of391L6gPNTMnWXNwUdKyuiSoJaaa"
        },
        {
          "name": "programData"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "initParams"
            }
          }
        }
      ]
    },
    {
      "name": "releaseEpoch",
      "docs": [
        "Anyone, after `unlock_at`: sends the epoch's locked tokens to the treasury."
      ],
      "discriminator": [
        79,
        115,
        5,
        28,
        96,
        1,
        137,
        147
      ],
      "accounts": [
        {
          "name": "caller",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "lockEpoch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104
                ]
              },
              {
                "kind": "arg",
                "path": "epoch"
              }
            ]
          }
        },
        {
          "name": "lockVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  99,
                  107,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "treasury"
        },
        {
          "name": "treasuryToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "treasury"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "epoch",
          "type": "u32"
        }
      ]
    },
    {
      "name": "setPaused",
      "docs": [
        "Admin only. Stops or resumes new purchases."
      ],
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "ad",
      "discriminator": [
        81,
        91,
        73,
        106,
        215,
        137,
        214,
        47
      ]
    },
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "lockEpoch",
      "discriminator": [
        79,
        171,
        30,
        226,
        38,
        184,
        19,
        233
      ]
    },
    {
      "name": "shard",
      "discriminator": [
        141,
        83,
        41,
        244,
        139,
        88,
        245,
        70
      ]
    }
  ],
  "events": [
    {
      "name": "adClosed",
      "discriminator": [
        60,
        85,
        233,
        165,
        156,
        38,
        47,
        74
      ]
    },
    {
      "name": "configInitialized",
      "discriminator": [
        181,
        49,
        200,
        156,
        19,
        167,
        178,
        91
      ]
    },
    {
      "name": "epochReleased",
      "discriminator": [
        49,
        122,
        185,
        26,
        163,
        250,
        254,
        249
      ]
    },
    {
      "name": "lotsBought",
      "discriminator": [
        245,
        92,
        67,
        134,
        117,
        194,
        50,
        90
      ]
    },
    {
      "name": "pausedSet",
      "discriminator": [
        171,
        125,
        127,
        156,
        233,
        81,
        68,
        66
      ]
    },
    {
      "name": "refundClaimed",
      "discriminator": [
        136,
        64,
        242,
        99,
        4,
        244,
        208,
        130
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "notUpgradeAuthority",
      "msg": "Only the program's upgrade authority can initialize"
    },
    {
      "code": 6001,
      "name": "invalidParams",
      "msg": "Launch parameter out of range"
    },
    {
      "code": 6002,
      "name": "unsupportedMint",
      "msg": "The token mint has an extension or authority that could move, freeze or tax locked tokens"
    },
    {
      "code": 6003,
      "name": "notAdmin",
      "msg": "Only the admin can do this"
    },
    {
      "code": 6004,
      "name": "notAdOwner",
      "msg": "Only the ad's owner can do this"
    },
    {
      "code": 6005,
      "name": "paused",
      "msg": "Buying is paused"
    },
    {
      "code": 6006,
      "name": "rectOutOfBounds",
      "msg": "Rectangle is outside the board"
    },
    {
      "code": 6007,
      "name": "rectTooLarge",
      "msg": "Rectangle is empty or larger than the limit"
    },
    {
      "code": 6008,
      "name": "invalidLink",
      "msg": "Link must be an https:// URL of printable ASCII, at most 200 bytes"
    },
    {
      "code": 6009,
      "name": "invalidImageUri",
      "msg": "Image URI must be printable ASCII, 1 to 200 bytes"
    },
    {
      "code": 6010,
      "name": "invalidTitle",
      "msg": "Title must be at most 64 characters with no control characters"
    },
    {
      "code": 6011,
      "name": "missingImageHash",
      "msg": "Image hash is missing"
    },
    {
      "code": 6012,
      "name": "wrongEpoch",
      "msg": "Epoch must be the current one or the next"
    },
    {
      "code": 6013,
      "name": "slippageExceeded",
      "msg": "Total price is above max_total"
    },
    {
      "code": 6014,
      "name": "ownLot",
      "msg": "You already own this lot"
    },
    {
      "code": 6015,
      "name": "wrongShards",
      "msg": "Shard accounts are missing, out of order or wrong"
    },
    {
      "code": 6016,
      "name": "priorAdMissing",
      "msg": "A previous ad of a taken lot is missing from the accounts"
    },
    {
      "code": 6017,
      "name": "invalidPriorAd",
      "msg": "Account is not a writable Lotz ad"
    },
    {
      "code": 6018,
      "name": "tooManyPriorAds",
      "msg": "The rectangle takes lots from too many ads; split the purchase"
    },
    {
      "code": 6019,
      "name": "nothingToClaim",
      "msg": "Nothing to claim"
    },
    {
      "code": 6020,
      "name": "adNotEmpty",
      "msg": "Ad still has live lots or an unclaimed refund"
    },
    {
      "code": 6021,
      "name": "stillLocked",
      "msg": "This epoch is still locked"
    },
    {
      "code": 6022,
      "name": "alreadyReleased",
      "msg": "This epoch was already released"
    },
    {
      "code": 6023,
      "name": "wrongTreasury",
      "msg": "Wrong treasury"
    },
    {
      "code": 6024,
      "name": "invalidShardIndex",
      "msg": "Shard index out of range"
    },
    {
      "code": 6025,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    }
  ],
  "types": [
    {
      "name": "ad",
      "docs": [
        "PDA `[\"ad\", owner, nonce.to_le_bytes()]`. Created by `buy`; immutable except for the takeover counters.",
        "The account is sized to its strings, so the rent is as low as it can be; `close_ad` returns it."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "adId",
            "type": "u64"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "docs": [
              "Chosen by the buyer's client; only makes the address unique."
            ],
            "type": "u64"
          },
          {
            "name": "x",
            "docs": [
              "Rectangle in lots."
            ],
            "type": "u8"
          },
          {
            "name": "y",
            "type": "u8"
          },
          {
            "name": "w",
            "type": "u8"
          },
          {
            "name": "h",
            "type": "u8"
          },
          {
            "name": "lotsAlive",
            "docs": [
              "Lots of this ad still on the board."
            ],
            "type": "u16"
          },
          {
            "name": "refundDue",
            "docs": [
              "Refunds for lots taken over and not yet claimed."
            ],
            "type": "u64"
          },
          {
            "name": "paidTotal",
            "docs": [
              "What the buyer paid in total for this ad."
            ],
            "type": "u64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "imageHash",
            "docs": [
              "sha256 of the image file at `image_uri`."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "imageUri",
            "type": "string"
          },
          {
            "name": "link",
            "type": "string"
          },
          {
            "name": "title",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "adClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "adId",
            "type": "u64"
          },
          {
            "name": "ad",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "buyArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "nonce",
            "docs": [
              "Any u64 the buyer's client picks; only makes the ad's address unique."
            ],
            "type": "u64"
          },
          {
            "name": "x",
            "docs": [
              "Rectangle in lots: `x, y` in `0..100`, `w, h` in `1..=max_rect`."
            ],
            "type": "u8"
          },
          {
            "name": "y",
            "type": "u8"
          },
          {
            "name": "w",
            "type": "u8"
          },
          {
            "name": "h",
            "type": "u8"
          },
          {
            "name": "epoch",
            "docs": [
              "Lock epoch the payment goes to: the current one, or the next (for a transaction sent near the boundary)."
            ],
            "type": "u32"
          },
          {
            "name": "maxTotal",
            "docs": [
              "The transaction fails if the total is above this (price moved between quote and signature)."
            ],
            "type": "u64"
          },
          {
            "name": "imageHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "imageUri",
            "type": "string"
          },
          {
            "name": "link",
            "type": "string"
          },
          {
            "name": "title",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "config",
      "docs": [
        "PDA `[\"config\"]`. Launch parameters are written once by `initialize` and never change; only the counters and",
        "`paused` move afterwards."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "docs": [
              "Can pause and resume new purchases, nothing else. No access to the vaults."
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenMint",
            "type": "pubkey"
          },
          {
            "name": "tokenProgram",
            "docs": [
              "The token program that owns `token_mint` (SPL Token or Token-2022)."
            ],
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "docs": [
              "Wallet whose ATA receives every released epoch. Fixed at `initialize`."
            ],
            "type": "pubkey"
          },
          {
            "name": "basePrice",
            "docs": [
              "Price of a free lot in tier 0, in base units of the token."
            ],
            "type": "u64"
          },
          {
            "name": "tierSize",
            "docs": [
              "Lots per price tier."
            ],
            "type": "u16"
          },
          {
            "name": "tierMultBps",
            "docs": [
              "Price multiplier from one tier to the next, in bps (12_500 = 1.25x)."
            ],
            "type": "u16"
          },
          {
            "name": "takeoverMultBps",
            "docs": [
              "Always `TAKEOVER_MULT_BPS` (15_000 = 1.5x); stored so clients read it from the chain."
            ],
            "type": "u16"
          },
          {
            "name": "maxRect",
            "docs": [
              "Largest rectangle side, in lots (<= 10)."
            ],
            "type": "u8"
          },
          {
            "name": "lockPeriod",
            "docs": [
              "Always `LOCK_PERIOD` (365 days)."
            ],
            "type": "i64"
          },
          {
            "name": "epochLen",
            "docs": [
              "Always `EPOCH_LEN` (7 days)."
            ],
            "type": "i64"
          },
          {
            "name": "launchTs",
            "docs": [
              "Unix time of `initialize`; epoch `k` is `[launch_ts + k*epoch_len, launch_ts + (k+1)*epoch_len)`."
            ],
            "type": "i64"
          },
          {
            "name": "lotsSold",
            "docs": [
              "Lots sold at least once. A sold lot never becomes free again."
            ],
            "type": "u16"
          },
          {
            "name": "takeovers",
            "docs": [
              "Lots taken over, all time."
            ],
            "type": "u64"
          },
          {
            "name": "totalLocked",
            "docs": [
              "Tokens paid into the lock, all time."
            ],
            "type": "u64"
          },
          {
            "name": "totalReleased",
            "docs": [
              "Tokens released from the lock to the treasury, all time."
            ],
            "type": "u64"
          },
          {
            "name": "nextAdId",
            "docs": [
              "Sequential id of the next ad. Starts at 1; 0 marks a free lot in a shard."
            ],
            "type": "u64"
          },
          {
            "name": "paused",
            "docs": [
              "Stops `buy` only."
            ],
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "lockVaultBump",
            "type": "u8"
          },
          {
            "name": "refundVaultBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "configInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "tokenMint",
            "type": "pubkey"
          },
          {
            "name": "tokenProgram",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "basePrice",
            "type": "u64"
          },
          {
            "name": "tierSize",
            "type": "u16"
          },
          {
            "name": "tierMultBps",
            "type": "u16"
          },
          {
            "name": "takeoverMultBps",
            "type": "u16"
          },
          {
            "name": "maxRect",
            "type": "u8"
          },
          {
            "name": "lockPeriod",
            "type": "i64"
          },
          {
            "name": "epochLen",
            "type": "i64"
          },
          {
            "name": "launchTs",
            "type": "i64"
          },
          {
            "name": "paused",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "epochReleased",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "epoch",
            "type": "u32"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "totalReleased",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "initParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "basePrice",
            "docs": [
              "Tier-0 price of a free lot, in base units of the token."
            ],
            "type": "u64"
          },
          {
            "name": "tierSize",
            "type": "u16"
          },
          {
            "name": "tierMultBps",
            "type": "u16"
          },
          {
            "name": "maxRect",
            "docs": [
              "Largest rectangle side in lots, 1..=10."
            ],
            "type": "u8"
          },
          {
            "name": "paused",
            "docs": [
              "Start paused (the admin resumes with `set_paused(false)`)."
            ],
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "lockEpoch",
      "docs": [
        "PDA `[\"epoch\", k.to_le_bytes()]` (k: u32). Everything locked during week `k` after launch."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "epoch",
            "type": "u32"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "unlockAt",
            "docs": [
              "`launch_ts + (k+1)*epoch_len + lock_period`."
            ],
            "type": "i64"
          },
          {
            "name": "released",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "lot",
      "docs": [
        "One lot inside a shard."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "adId",
            "docs": [
              "Id of the ad currently on this lot; 0 = never sold."
            ],
            "type": "u64"
          },
          {
            "name": "lastPrice",
            "docs": [
              "What the current owner paid for this lot."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "lotsBought",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "adId",
            "type": "u64"
          },
          {
            "name": "ad",
            "type": "pubkey"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "x",
            "type": "u8"
          },
          {
            "name": "y",
            "type": "u8"
          },
          {
            "name": "w",
            "type": "u8"
          },
          {
            "name": "h",
            "type": "u8"
          },
          {
            "name": "freeLots",
            "type": "u16"
          },
          {
            "name": "takenLots",
            "type": "u16"
          },
          {
            "name": "tier",
            "docs": [
              "Price tier the free lots were priced at."
            ],
            "type": "u16"
          },
          {
            "name": "freeLotPrice",
            "docs": [
              "Price of one free lot at that tier."
            ],
            "type": "u64"
          },
          {
            "name": "paidTotal",
            "type": "u64"
          },
          {
            "name": "locked",
            "type": "u64"
          },
          {
            "name": "refunded",
            "type": "u64"
          },
          {
            "name": "epoch",
            "type": "u32"
          },
          {
            "name": "lotsSold",
            "docs": [
              "`Config.lots_sold` after this purchase."
            ],
            "type": "u16"
          },
          {
            "name": "prior",
            "type": {
              "vec": {
                "defined": {
                  "name": "priorAdHit"
                }
              }
            }
          },
          {
            "name": "imageHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "imageUri",
            "type": "string"
          },
          {
            "name": "link",
            "type": "string"
          },
          {
            "name": "title",
            "type": "string"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "pausedSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "paused",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "priorAdHit",
      "docs": [
        "One previous ad that lost lots in a purchase."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "adId",
            "type": "u64"
          },
          {
            "name": "lots",
            "type": "u16"
          },
          {
            "name": "refund",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "refundClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "adId",
            "type": "u64"
          },
          {
            "name": "ad",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "shard",
      "docs": [
        "PDA `[\"shard\", [index]]`. Shard `index` covers lots `lx in [10*(index%10), +10)`, `ly in [10*(index/10), +10)`;",
        "`lots` is row-major inside the shard: `lots[(ly%10)*10 + lx%10]`."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "lots",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "lot"
                  }
                },
                100
              ]
            }
          },
          {
            "name": "index",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          }
        ]
      }
    }
  ]
};
