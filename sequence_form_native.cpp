// Complete, unabstracted Tic-Tac-Nope sequence-form enumeration.
//
// This is a C ABI backend for sequence_form_lp.py. It performs exactly the
// Python enumerator's ascending-action DFS, including every terminal history.
// Only representation changes: masks, losslessly encoded observation strings,
// and compact arrays replace Python objects. No histories or information sets
// are sampled, merged beyond the original information key, or pruned.

#include <array>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <ctime>
#include <exception>
#include <limits>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

struct Control { std::atomic<bool> cancelled{false}; };

using u128 = unsigned __int128;
constexpr std::uint16_t FULL_MASK = 0x1ff;
constexpr int X = 1;
constexpr int O = 2;
// Error reporting must still work after allocation failure. Keep this buffer
// fixed-size so no exception can escape the C ABI's noexcept boundary.
thread_local char last_error[1024] = {};

void set_error(const char* message) noexcept {
    std::snprintf(last_error, sizeof(last_error), "%s", message);
}

std::uint64_t checked_increment(std::uint64_t& value, const char* what) {
    if (value == std::numeric_limits<std::uint64_t>::max()) {
        throw std::overflow_error(what);
    }
    return ++value;
}

std::uint64_t mix64(std::uint64_t value) noexcept {
    value ^= value >> 30;
    value *= UINT64_C(0xbf58476d1ce4e5b9);
    value ^= value >> 27;
    value *= UINT64_C(0x94d049bb133111eb);
    return value ^ (value >> 31);
}

std::uint64_t observation_hash(std::uint64_t low, std::uint64_t high) noexcept {
    return mix64(low ^ (mix64(high) + UINT64_C(0x9e3779b97f4a7c15)));
}

struct Catalog {
    // These vectors are the public C ABI arrays, in information-set order.
    std::vector<std::uint64_t> obs_low;
    std::vector<std::uint64_t> obs_high;
    std::vector<std::uint64_t> parent;
    std::vector<std::uint64_t> first_child;
    std::vector<std::uint16_t> action_mask;
    std::uint64_t n_sequences = 1;  // Sequence zero is the empty sequence.

    // A zero slot is empty; other slots store an information-set index + 1.
    // Observation keys are already stored in the output arrays, so the hash
    // table need not allocate nodes or duplicate the 128-bit keys.
    std::vector<std::uint64_t> slots = std::vector<std::uint64_t>(1024, 0);

    std::size_t find_slot(std::uint64_t low, std::uint64_t high) const noexcept {
        const std::size_t mask = slots.size() - 1;
        std::size_t position = observation_hash(low, high) & mask;
        while (slots[position]) {
            const std::size_t index = static_cast<std::size_t>(slots[position] - 1);
            if (obs_low[index] == low && obs_high[index] == high) {
                break;
            }
            position = (position + 1) & mask;
        }
        return position;
    }

    void grow_slots() {
        if (slots.size() > slots.max_size() / 2) {
            throw std::overflow_error("Information-set hash table capacity exceeded");
        }
        std::vector<std::uint64_t> replacement(slots.size() * 2, 0);
        const std::size_t mask = replacement.size() - 1;
        for (std::size_t i = 0; i < obs_low.size(); ++i) {
            std::size_t position = observation_hash(obs_low[i], obs_high[i]) & mask;
            while (replacement[position]) {
                position = (position + 1) & mask;
            }
            replacement[position] = static_cast<std::uint64_t>(i) + 1;
        }
        slots.swap(replacement);
    }

    std::uint64_t register_info(u128 observation, std::uint64_t parent_sequence,
                                std::uint16_t actions) {
        const auto low = static_cast<std::uint64_t>(observation);
        const auto high = static_cast<std::uint64_t>(observation >> 64);
        std::size_t position = find_slot(low, high);
        if (slots[position]) {
            const std::size_t index = static_cast<std::size_t>(slots[position] - 1);
            if (parent[index] != parent_sequence) {
                throw std::runtime_error("Perfect-recall violation: information set has inconsistent parent sequences");
            }
            if (action_mask[index] != actions) {
                throw std::runtime_error("Information-set legality mismatch");
            }
            return first_child[index];
        }

        // Keep occupancy below 75%; slots.size() is a power of two.
        if (obs_low.size() + 1 >= slots.size() - slots.size() / 4) {
            grow_slots();
            position = find_slot(low, high);
        }
        if (obs_low.size() >= std::numeric_limits<std::uint64_t>::max() - 1) {
            throw std::overflow_error("Information-set count exceeds uint64 capacity");
        }
        const auto action_count = static_cast<std::uint64_t>(__builtin_popcount(actions));
        if (n_sequences > std::numeric_limits<std::uint64_t>::max() - action_count) {
            throw std::overflow_error("Sequence count exceeds uint64 capacity");
        }
        const std::uint64_t first = n_sequences;
        obs_low.push_back(low);
        obs_high.push_back(high);
        parent.push_back(parent_sequence);
        first_child.push_back(first);
        action_mask.push_back(actions);
        n_sequences += action_count;
        slots[position] = static_cast<std::uint64_t>(obs_low.size());
        return first;
    }

    void release_index() {
        std::vector<std::uint64_t>().swap(slots);
    }
};

struct Game {
    const Control* control;
    std::uint16_t hidden;
    std::uint64_t node_limit;
    std::uint64_t histories = 0;
    std::uint64_t terminals = 0;
    Catalog o;
    Catalog x;
    std::vector<std::uint64_t> payoff_rows;
    std::vector<std::uint64_t> payoff_cols;
    std::vector<std::int8_t> payoff_values;
    std::array<bool, 512> wins{};
    std::chrono::steady_clock::time_point started = std::chrono::steady_clock::now();
    std::uint64_t next_progress = 10000000;

    explicit Game(std::uint16_t hidden_mask, std::uint64_t limit, const Control* run_control)
        : control(run_control), hidden(hidden_mask), node_limit(limit) {
        constexpr std::array<std::uint16_t, 8> patterns = {
            0x007, 0x038, 0x1c0, 0x049, 0x092, 0x124, 0x111, 0x054
        };
        for (std::size_t mask = 0; mask < wins.size(); ++mask) {
            for (std::uint16_t pattern : patterns) {
                if ((mask & pattern) == pattern) {
                    wins[mask] = true;
                    break;
                }
            }
        }
    }

    void progress() {
        const auto now = std::chrono::system_clock::now();
        const std::time_t timestamp = std::chrono::system_clock::to_time_t(now);
        std::tm local{};
        char formatted[64] = {};
#if defined(_WIN32)
        localtime_s(&local, &timestamp);
#else
        localtime_r(&timestamp, &local);
#endif
        std::strftime(formatted, sizeof(formatted), "%Y-%m-%dT%H:%M:%S%z", &local);
        const double seconds = std::chrono::duration<double>(
            std::chrono::steady_clock::now() - started).count();
        std::fprintf(stderr,
            "[%s] Native enumeration: %llu histories, %llu terminals, "
            "%llu O infos, %llu X infos (%.1fs)\n",
            formatted,
            static_cast<unsigned long long>(histories),
            static_cast<unsigned long long>(terminals),
            static_cast<unsigned long long>(o.obs_low.size()),
            static_cast<unsigned long long>(x.obs_low.size()), seconds);
        std::fflush(stderr);
        if (next_progress <= std::numeric_limits<std::uint64_t>::max() - 10000000) {
            next_progress += 10000000;
        } else {
            next_progress = std::numeric_limits<std::uint64_t>::max();
        }
    }

    void visit(std::uint16_t o_mask, std::uint16_t x_mask,
               std::uint16_t tried_o, std::uint16_t tried_x, int actor,
               u128 obs_o, u128 obs_x, std::uint64_t seq_o, std::uint64_t seq_x) {
        checked_increment(histories, "History count exceeds uint64 capacity");
        if ((histories & 65535) == 1 && control && control->cancelled.load(std::memory_order_relaxed)) {
            throw std::runtime_error("Native enumeration cancelled");
        }
        if (node_limit && histories > node_limit) {
            throw std::runtime_error("Node limit " + std::to_string(node_limit) +
                " exceeded. This guard prevents an accidental full-memory solve; "
                "rerun with a larger limit or 0 only when you intend to build the complete game.");
        }
        if (histories >= next_progress) {
            progress();
        }

        const std::uint16_t occupied = o_mask | x_mask;
        const bool o_win = wins[o_mask];
        const bool x_win = wins[x_mask];
        if (o_win || x_win || occupied == FULL_MASK) {
            checked_increment(terminals, "Terminal count exceeds uint64 capacity");
            if (o_win || x_win) {
                if (payoff_rows.size() == std::numeric_limits<std::uint64_t>::max()) {
                    throw std::overflow_error("Payoff entry count exceeds uint64 capacity");
                }
                payoff_rows.push_back(seq_o);
                payoff_cols.push_back(seq_x);
                payoff_values.push_back(o_win ? 1 : -1);
            }
            return;
        }

        const std::uint16_t tried = actor == O ? tried_o : tried_x;
        const std::uint16_t actions = ((hidden & ~tried) | (~hidden & ~occupied)) & FULL_MASK;
        Catalog& catalog = actor == O ? o : x;
        const std::uint64_t first = catalog.register_info(
            actor == O ? obs_o : obs_x, actor == O ? seq_o : seq_x, actions);

        // Each token takes five bits, with nonzero values, so leading history
        // tokens are retained exactly and no explicit history length is needed.
        // Reachable game histories have at most 18 moves (90 bits). Also guard
        // caller-supplied subtree observations against truncation.
        if ((obs_o >> 123) || (obs_x >> 123)) {
            throw std::overflow_error("Observation history exceeds the lossless 128-bit encoding");
        }
        const u128 shifted_o = obs_o << 5;
        const u128 shifted_x = obs_x << 5;
        std::uint16_t remaining = actions;
        std::uint64_t child_sequence = first;
        while (remaining) {
            const int move = __builtin_ctz(static_cast<unsigned int>(remaining));
            const std::uint16_t cell = static_cast<std::uint16_t>(1u << move);
            remaining = static_cast<std::uint16_t>(remaining & (remaining - 1));
            std::uint16_t child_o = o_mask;
            std::uint16_t child_x = x_mask;
            std::uint16_t child_tried_o = tried_o;
            std::uint16_t child_tried_x = tried_x;
            unsigned token_o;
            unsigned token_x;
            if (hidden & cell) {
                if (actor == O) {
                    child_tried_o |= cell;
                    token_o = static_cast<unsigned>(2 + move);
                    token_x = 1;
                } else {
                    child_tried_x |= cell;
                    token_o = 1;
                    token_x = static_cast<unsigned>(2 + move);
                }
                if (!(occupied & cell)) {
                    if (actor == O) {
                        child_o |= cell;
                    } else {
                        child_x |= cell;
                    }
                }
            } else {
                if (actor == O) {
                    child_o |= cell;
                } else {
                    child_x |= cell;
                }
                token_o = token_x = static_cast<unsigned>((actor == X ? 11 : 20) + move);
            }
            visit(child_o, child_x, child_tried_o, child_tried_x, actor == O ? X : O,
                  shifted_o | token_o, shifted_x | token_x,
                  actor == O ? child_sequence : seq_o,
                  actor == X ? child_sequence : seq_x);
            ++child_sequence;
        }
    }
};

const void* catalog_data(const Catalog& catalog, int field) {
    switch (field) {
        case 0: return catalog.obs_low.data();
        case 1: return catalog.obs_high.data();
        case 2: return catalog.parent.data();
        case 3: return catalog.first_child.data();
        case 4: return catalog.action_mask.data();
        default: return nullptr;
    }
}

}  // namespace

extern "C" {

const char* ttn_information_model() noexcept {
    return "hidden-attempt-location-no-result-v2";
}

void* ttn_control_new() noexcept {
    auto* control = new (std::nothrow) Control;
    if (!control) set_error("Unable to allocate native cancellation control");
    return control;
}

void ttn_control_cancel(void* pointer) noexcept {
    if (pointer) static_cast<Control*>(pointer)->cancelled.store(true, std::memory_order_relaxed);
}

void ttn_control_free(void* pointer) noexcept { delete static_cast<Control*>(pointer); }

// Min/max linear optimization over the *complete* realization constraints.
// Each info contributes its optimal child value to its parent. Multiple infos
// with the same parent contribute additively; no observations are merged.
int ttn_best_response(std::uint64_t n_infos, std::uint64_t n_sequences,
                      const std::uint64_t* parents, const std::uint64_t* first,
                      const std::uint16_t* actions, double* values, int maximize) noexcept {
    if (!n_sequences) return 1;
    for (std::uint64_t index = n_infos; index-- > 0;) {
        const unsigned count = __builtin_popcount(static_cast<unsigned>(actions[index]));
        if (!count || first[index] >= n_sequences || count > n_sequences - first[index]
            || parents[index] >= first[index]) return 1;
        double best = values[first[index]];
        for (unsigned j = 1; j < count; ++j) {
            const double value = values[first[index] + j];
            if (maximize ? value > best : value < best) best = value;
        }
        values[parents[index]] += best;
    }
    return 0;
}

int ttn_best_response_plan(std::uint64_t n_infos, std::uint64_t n_sequences,
                           const std::uint64_t* parents, const std::uint64_t* first,
                           const std::uint16_t* actions, double* values, int maximize,
                           std::uint8_t* realization, double* potentials, double* secondary) noexcept {
    try {
        if (!n_sequences) return 1;
        std::vector<std::uint8_t> choices(n_infos);
        for (std::uint64_t index = n_infos; index-- > 0;) {
            const unsigned count = __builtin_popcount(static_cast<unsigned>(actions[index]));
            if (!count || first[index] >= n_sequences || count > n_sequences - first[index]
                || parents[index] >= first[index]) return 1;
            double best = values[first[index]];
            double second_best = secondary ? secondary[first[index]] : 0.0;
            unsigned choice = 0;
            for (unsigned j = 1; j < count; ++j) {
                const double value = values[first[index] + j];
                const double second = secondary ? secondary[first[index] + j] : 0.0;
                if ((maximize ? value > best : value < best) ||
                    (value == best && (maximize ? second > second_best : second < second_best))) {
                    best = value; second_best = second; choice = j;
                }
            }
            choices[index] = static_cast<std::uint8_t>(choice);
            potentials[index + 1] = -best;
            values[parents[index]] += best;
            if (secondary) secondary[parents[index]] += second_best;
        }
        potentials[0] = values[0];
        realization[0] = 1;
        for (std::uint64_t index = 0; index < n_infos; ++index) {
            if (realization[parents[index]]) realization[first[index] + choices[index]] = 1;
        }
        return 0;
    } catch (...) {
        set_error("Unable to construct complete best response");
        return 1;
    }
}

const char* ttn_error() noexcept {
    return last_error;
}

void* ttn_build(std::uint16_t hidden, int start,
                std::uint16_t o_mask, std::uint16_t x_mask,
                std::uint16_t tried_o, std::uint16_t tried_x, int turn,
                std::uint64_t obs_o_lo, std::uint64_t obs_o_hi,
                std::uint64_t obs_x_lo, std::uint64_t obs_x_hi,
                std::uint64_t node_limit, void* control) noexcept {
    last_error[0] = '\0';
    try {
        if (((hidden | o_mask | x_mask | tried_o | tried_x) & ~FULL_MASK) != 0) {
            throw std::invalid_argument("Board and tried masks must fit the nine-cell board");
        }
        if ((start != O && start != X) || (turn != O && turn != X)) {
            throw std::invalid_argument("Starting player and turn must be O (2) or X (1)");
        }
        const u128 obs_o = (static_cast<u128>(obs_o_hi) << 64) | obs_o_lo;
        const u128 obs_x = (static_cast<u128>(obs_x_hi) << 64) | obs_x_lo;
        auto game = std::make_unique<Game>(hidden, node_limit, static_cast<Control*>(control));
        game->visit(o_mask, x_mask, tried_o, tried_x, turn, obs_o, obs_x, 0, 0);
        game->o.release_index();
        game->x.release_index();
        return game.release();
    } catch (const std::bad_alloc&) {
        set_error("Insufficient memory while enumerating the complete exact game");
    } catch (const std::exception& error) {
        set_error(error.what());
    } catch (...) {
        set_error("Unknown native enumeration failure");
    }
    return nullptr;
}

void ttn_free(void* pointer) noexcept {
    delete static_cast<Game*>(pointer);
}

std::uint64_t ttn_count(void* pointer, int field) noexcept {
    if (!pointer) {
        set_error("Cannot read counts from a null game");
        return 0;
    }
    const Game& game = *static_cast<Game*>(pointer);
    switch (field) {
        case 0: return game.histories;
        case 1: return game.terminals;
        case 2: return static_cast<std::uint64_t>(game.o.obs_low.size());
        case 3: return static_cast<std::uint64_t>(game.x.obs_low.size());
        case 4: return game.o.n_sequences;
        case 5: return game.x.n_sequences;
        case 6: return static_cast<std::uint64_t>(game.payoff_rows.size());
        default:
            set_error("Unknown count field");
            return 0;
    }
}

const void* ttn_data(void* pointer, int field) noexcept {
    if (!pointer) {
        set_error("Cannot read data from a null game");
        return nullptr;
    }
    const Game& game = *static_cast<Game*>(pointer);
    if (field >= 0 && field < 5) {
        return catalog_data(game.o, field);
    }
    if (field >= 5 && field < 10) {
        return catalog_data(game.x, field - 5);
    }
    switch (field) {
        case 10: return game.payoff_rows.data();
        case 11: return game.payoff_cols.data();
        case 12: return game.payoff_values.data();
        default:
            set_error("Unknown data field");
            return nullptr;
    }
}

}  // extern "C"
