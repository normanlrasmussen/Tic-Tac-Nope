// Complete, unabstracted Tic-Tac-Nope sequence-form enumeration.
//
// This C ABI backend preserves every history and information set, but aggregates
// terminal contributions natively before Python ever sees the payoff matrix.

#include <algorithm>
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
constexpr std::size_t PAYOFF_CHUNK = 1u << 20;
thread_local char last_error[1024] = {};

void set_error(const char* message) noexcept {
    std::snprintf(last_error, sizeof(last_error), "%s", message);
}

std::uint64_t checked_increment(std::uint64_t& value, const char* what) {
    if (value == std::numeric_limits<std::uint64_t>::max()) throw std::overflow_error(what);
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
    std::vector<std::uint64_t> obs_low;
    std::vector<std::uint64_t> obs_high;
    std::vector<std::uint64_t> parent;
    std::vector<std::uint64_t> first_child;
    std::vector<std::uint16_t> action_mask;
    std::uint64_t n_sequences = 1;
    std::vector<std::uint64_t> slots = std::vector<std::uint64_t>(1024, 0);

    std::size_t find_slot(std::uint64_t low, std::uint64_t high) const noexcept {
        const std::size_t mask = slots.size() - 1;
        std::size_t position = observation_hash(low, high) & mask;
        while (slots[position]) {
            const std::size_t index = static_cast<std::size_t>(slots[position] - 1);
            if (obs_low[index] == low && obs_high[index] == high) break;
            position = (position + 1) & mask;
        }
        return position;
    }

    void grow_slots() {
        if (slots.size() > slots.max_size() / 2) throw std::overflow_error("Information-set hash table capacity exceeded");
        std::vector<std::uint64_t> replacement(slots.size() * 2, 0);
        const std::size_t mask = replacement.size() - 1;
        for (std::size_t i = 0; i < obs_low.size(); ++i) {
            std::size_t position = observation_hash(obs_low[i], obs_high[i]) & mask;
            while (replacement[position]) position = (position + 1) & mask;
            replacement[position] = static_cast<std::uint64_t>(i) + 1;
        }
        slots.swap(replacement);
    }

    std::uint64_t register_info(u128 observation, std::uint64_t parent_sequence, std::uint16_t actions) {
        const auto low = static_cast<std::uint64_t>(observation);
        const auto high = static_cast<std::uint64_t>(observation >> 64);
        std::size_t position = find_slot(low, high);
        if (slots[position]) {
            const std::size_t index = static_cast<std::size_t>(slots[position] - 1);
            if (parent[index] != parent_sequence) throw std::runtime_error("Perfect-recall violation: information set has inconsistent parent sequences");
            if (action_mask[index] != actions) throw std::runtime_error("Information-set legality mismatch");
            return first_child[index];
        }
        if (obs_low.size() + 1 >= slots.size() - slots.size() / 4) {
            grow_slots();
            position = find_slot(low, high);
        }
        const auto action_count = static_cast<std::uint64_t>(__builtin_popcount(actions));
        if (n_sequences > std::numeric_limits<std::uint64_t>::max() - action_count) throw std::overflow_error("Sequence count exceeds uint64 capacity");
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

    void release_index() { std::vector<std::uint64_t>().swap(slots); }
};

struct Payoff32 { std::uint64_t key; std::int64_t value; };
struct Payoff64 { std::uint64_t row; std::uint64_t col; std::int64_t value; };

struct Game {
    const Control* control;
    std::uint16_t hidden;
    std::uint64_t node_limit;
    std::uint64_t histories = 0;
    std::uint64_t terminals = 0;
    std::uint64_t decisive_terminals = 0;
    std::uint64_t payoff_flushes = 0;
    Catalog o;
    Catalog x;
    bool wide_payoff = false;
    std::vector<Payoff32> payoff32;
    std::vector<Payoff64> payoff64;
    std::vector<std::uint64_t> pending_pos32;
    std::vector<std::uint64_t> pending_neg32;
    std::vector<u128> pending_pos64;
    std::vector<u128> pending_neg64;
    std::array<bool, 512> wins{};
    std::chrono::steady_clock::time_point started = std::chrono::steady_clock::now();
    std::uint64_t next_progress = 10000000;

    explicit Game(std::uint16_t hidden_mask, std::uint64_t limit, const Control* run_control)
        : control(run_control), hidden(hidden_mask), node_limit(limit) {
        pending_pos32.reserve(PAYOFF_CHUNK / 2);
        pending_neg32.reserve(PAYOFF_CHUNK / 2);
        constexpr std::array<std::uint16_t, 8> patterns = {0x007,0x038,0x1c0,0x049,0x092,0x124,0x111,0x054};
        for (std::size_t mask = 0; mask < wins.size(); ++mask) {
            for (std::uint16_t pattern : patterns) if ((mask & pattern) == pattern) { wins[mask] = true; break; }
        }
    }

    static bool less32(const Payoff32& a, const Payoff32& b) { return a.key < b.key; }
    static bool less64(const Payoff64& a, const Payoff64& b) {
        return a.row < b.row || (a.row == b.row && a.col < b.col);
    }

    template <class Entry, class Less>
    static void merge_sorted_unique(std::vector<Entry>& values, std::size_t old_size, Less less) {
        if (old_size > values.size()) throw std::logic_error("Invalid payoff merge boundary");

        // The prefix [0, old_size) and suffix [old_size, end) are independently
        // sorted.  Do not hand-roll a backwards merge inside the same vector:
        // writing into the suffix can overwrite an unread suffix entry.  The
        // standard-library merge handles overlapping storage safely.
        std::inplace_merge(
            values.begin(),
            values.begin() + static_cast<std::ptrdiff_t>(old_size),
            values.end(),
            less
        );

        // Coalesce equal sequence-pair keys and discard exact cancellation.
        std::size_t write = 0;
        for (std::size_t read = 0; read < values.size();) {
            Entry merged = values[read++];
            while (
                read < values.size()
                && !less(merged, values[read])
                && !less(values[read], merged)
            ) {
                merged.value += values[read].value;
                ++read;
            }
            if (merged.value != 0) values[write++] = merged;
        }
        values.resize(write);
    }

    static std::uint64_t pack32(std::uint64_t row, std::uint64_t col) {
        return (row << 32) | col;
    }

    void flush32() {
        if (pending_pos32.empty() && pending_neg32.empty()) return;
        ++payoff_flushes;
        std::sort(pending_pos32.begin(), pending_pos32.end());
        std::sort(pending_neg32.begin(), pending_neg32.end());
        const std::size_t old = payoff32.size();
        payoff32.reserve(old + pending_pos32.size() + pending_neg32.size());
        std::size_t p = 0, n = 0;
        while (p < pending_pos32.size() || n < pending_neg32.size()) {
            const std::uint64_t kp = p < pending_pos32.size() ? pending_pos32[p] : std::numeric_limits<std::uint64_t>::max();
            const std::uint64_t kn = n < pending_neg32.size() ? pending_neg32[n] : std::numeric_limits<std::uint64_t>::max();
            const std::uint64_t key = std::min(kp, kn);
            std::int64_t value = 0;
            while (p < pending_pos32.size() && pending_pos32[p] == key) { ++value; ++p; }
            while (n < pending_neg32.size() && pending_neg32[n] == key) { --value; ++n; }
            if (value) payoff32.push_back({key, value});
        }
        merge_sorted_unique(payoff32, old, less32);
        pending_pos32.clear();
        pending_neg32.clear();
    }

    void promote_to_wide() {
        if (wide_payoff) return;
        flush32();
        payoff64.reserve(payoff32.size());
        for (const auto& item : payoff32) payoff64.push_back({item.key >> 32, item.key & UINT64_C(0xffffffff), item.value});
        std::vector<Payoff32>().swap(payoff32);
        std::vector<std::uint64_t>().swap(pending_pos32);
        std::vector<std::uint64_t>().swap(pending_neg32);
        pending_pos64.reserve(PAYOFF_CHUNK / 2);
        pending_neg64.reserve(PAYOFF_CHUNK / 2);
        wide_payoff = true;
    }

    void flush64() {
        if (pending_pos64.empty() && pending_neg64.empty()) return;
        ++payoff_flushes;
        std::sort(pending_pos64.begin(), pending_pos64.end());
        std::sort(pending_neg64.begin(), pending_neg64.end());
        const std::size_t old = payoff64.size();
        payoff64.reserve(old + pending_pos64.size() + pending_neg64.size());
        std::size_t p = 0, n = 0;
        const u128 max_key = ~static_cast<u128>(0);
        while (p < pending_pos64.size() || n < pending_neg64.size()) {
            const u128 kp = p < pending_pos64.size() ? pending_pos64[p] : max_key;
            const u128 kn = n < pending_neg64.size() ? pending_neg64[n] : max_key;
            const u128 key = kp < kn ? kp : kn;
            std::int64_t value = 0;
            while (p < pending_pos64.size() && pending_pos64[p] == key) { ++value; ++p; }
            while (n < pending_neg64.size() && pending_neg64[n] == key) { --value; ++n; }
            if (value) payoff64.push_back({static_cast<std::uint64_t>(key >> 64), static_cast<std::uint64_t>(key), value});
        }
        merge_sorted_unique(payoff64, old, less64);
        pending_pos64.clear();
        pending_neg64.clear();
    }

    void add_payoff(std::uint64_t row, std::uint64_t col, int sign) {
        checked_increment(decisive_terminals, "Decisive terminal count exceeds uint64 capacity");
        if (!wide_payoff && (row > UINT32_MAX || col > UINT32_MAX)) promote_to_wide();
        if (!wide_payoff) {
            auto& pending = sign > 0 ? pending_pos32 : pending_neg32;
            pending.push_back(pack32(row, col));
            if (pending_pos32.size() + pending_neg32.size() >= PAYOFF_CHUNK) flush32();
        } else {
            auto& pending = sign > 0 ? pending_pos64 : pending_neg64;
            pending.push_back((static_cast<u128>(row) << 64) | col);
            if (pending_pos64.size() + pending_neg64.size() >= PAYOFF_CHUNK) flush64();
        }
    }

    void finalize_payoff() { if (wide_payoff) flush64(); else flush32(); }
    std::uint64_t payoff_nnz() const { return static_cast<std::uint64_t>(wide_payoff ? payoff64.size() : payoff32.size()); }

    void progress() {
        const double seconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
        const auto pending = wide_payoff ? pending_pos64.size() + pending_neg64.size() : pending_pos32.size() + pending_neg32.size();
        std::fprintf(stderr,
            "Native enumeration: %llu histories, %llu terminals, %llu decisive, %llu O infos, %llu X infos, "
            "%llu O seq, %llu X seq, %llu aggregated payoff pairs + %llu pending (%.1fs)\n",
            static_cast<unsigned long long>(histories), static_cast<unsigned long long>(terminals),
            static_cast<unsigned long long>(decisive_terminals), static_cast<unsigned long long>(o.obs_low.size()),
            static_cast<unsigned long long>(x.obs_low.size()), static_cast<unsigned long long>(o.n_sequences),
            static_cast<unsigned long long>(x.n_sequences), static_cast<unsigned long long>(payoff_nnz()),
            static_cast<unsigned long long>(pending), seconds);
        std::fflush(stderr);
        next_progress = next_progress <= std::numeric_limits<std::uint64_t>::max() - 10000000
            ? next_progress + 10000000 : std::numeric_limits<std::uint64_t>::max();
    }

    void visit(std::uint16_t o_mask, std::uint16_t x_mask, std::uint16_t tried_o, std::uint16_t tried_x,
               int actor, u128 obs_o, u128 obs_x, std::uint64_t seq_o, std::uint64_t seq_x) {
        checked_increment(histories, "History count exceeds uint64 capacity");
        if ((histories & 65535) == 1 && control && control->cancelled.load(std::memory_order_relaxed)) throw std::runtime_error("Native enumeration cancelled");
        if (node_limit && histories > node_limit) throw std::runtime_error("Node limit " + std::to_string(node_limit) + " exceeded. This guard prevents an accidental full-memory solve; rerun with a larger limit or 0 only when you intend to build the complete game.");
        if (histories >= next_progress) progress();

        const std::uint16_t occ = o_mask | x_mask;
        const bool o_win = wins[o_mask], x_win = wins[x_mask];
        if (o_win || x_win || occ == FULL_MASK) {
            checked_increment(terminals, "Terminal count exceeds uint64 capacity");
            if (o_win || x_win) add_payoff(seq_o, seq_x, o_win ? 1 : -1);
            return;
        }

        const std::uint16_t tried = actor == O ? tried_o : tried_x;
        const std::uint16_t actions = ((hidden & ~tried) | (~hidden & ~occ)) & FULL_MASK;
        Catalog& catalog = actor == O ? o : x;
        const std::uint64_t first = catalog.register_info(actor == O ? obs_o : obs_x, actor == O ? seq_o : seq_x, actions);
        if ((obs_o >> 123) || (obs_x >> 123)) throw std::overflow_error("Observation history exceeds the lossless 128-bit encoding");
        const u128 shifted_o = obs_o << 5, shifted_x = obs_x << 5;
        std::uint16_t remaining = actions;
        std::uint64_t child_sequence = first;
        while (remaining) {
            const int move = __builtin_ctz(static_cast<unsigned int>(remaining));
            const std::uint16_t cell = static_cast<std::uint16_t>(1u << move);
            remaining = static_cast<std::uint16_t>(remaining & (remaining - 1));
            std::uint16_t child_o=o_mask, child_x=x_mask, child_to=tried_o, child_tx=tried_x;
            unsigned token_o, token_x;
            if (hidden & cell) {
                if (actor == O) { child_to |= cell; token_o=2+move; token_x=1; }
                else { child_tx |= cell; token_o=1; token_x=2+move; }
                if (!(occ & cell)) { if (actor == O) child_o |= cell; else child_x |= cell; }
            } else {
                if (actor == O) child_o |= cell; else child_x |= cell;
                token_o = token_x = static_cast<unsigned>((actor == X ? 11 : 20) + move);
            }
            visit(child_o, child_x, child_to, child_tx, actor == O ? X : O,
                  shifted_o | token_o, shifted_x | token_x,
                  actor == O ? child_sequence : seq_o, actor == X ? child_sequence : seq_x);
            ++child_sequence;
        }
    }
};

bool payoff_merge_self_check() {
    static const bool valid = []() {
        // Regression for the original overlap bug: the old key (16) must not
        // overwrite the unread new key (1) while the two sorted runs are merged.
        std::vector<Payoff32> overwrite = {{16, 2}, {1, 3}};
        Game::merge_sorted_unique(overwrite, 1, Game::less32);
        if (
            overwrite.size() != 2
            || overwrite[0].key != 1 || overwrite[0].value != 3
            || overwrite[1].key != 16 || overwrite[1].value != 2
        ) return false;

        // Also verify interleaving, duplicate coalescing, and exact cancellation.
        std::vector<Payoff32> cancellation = {{1, 2}, {4, 1}, {1, -2}, {3, 5}};
        Game::merge_sorted_unique(cancellation, 2, Game::less32);
        return cancellation.size() == 2
            && cancellation[0].key == 3 && cancellation[0].value == 5
            && cancellation[1].key == 4 && cancellation[1].value == 1;
    }();
    return valid;
}

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

template <class Index>
int fill_payoff_csr(const Game& game, Index* indptr, Index* indices, double* data) {
    const auto nrows = game.o.n_sequences;
    const auto ncols = game.x.n_sequences;
    if (nrows > static_cast<std::uint64_t>(std::numeric_limits<Index>::max()) ||
        ncols > static_cast<std::uint64_t>(std::numeric_limits<Index>::max()) ||
        game.payoff_nnz() > static_cast<std::uint64_t>(std::numeric_limits<Index>::max())) return 2;
    std::uint64_t row = 0, pos = 0;
    indptr[0] = 0;
    auto emit = [&](std::uint64_t r, std::uint64_t c, std::int64_t v) {
        while (row < r) indptr[++row] = static_cast<Index>(pos);
        indices[pos] = static_cast<Index>(c);
        data[pos] = static_cast<double>(v);
        ++pos;
    };
    if (game.wide_payoff) {
        for (const auto& item : game.payoff64) emit(item.row, item.col, item.value);
    } else {
        for (const auto& item : game.payoff32) emit(item.key >> 32, item.key & UINT64_C(0xffffffff), item.value);
    }
    while (row < nrows) indptr[++row] = static_cast<Index>(pos);
    return pos == game.payoff_nnz() ? 0 : 3;
}

} // namespace

extern "C" {

const char* ttn_information_model() noexcept { return "hidden-attempt-location-no-result-v2"; }
void* ttn_control_new() noexcept { auto* c = new (std::nothrow) Control; if (!c) set_error("Unable to allocate native cancellation control"); return c; }
void ttn_control_cancel(void* p) noexcept { if (p) static_cast<Control*>(p)->cancelled.store(true, std::memory_order_relaxed); }
void ttn_control_free(void* p) noexcept { delete static_cast<Control*>(p); }

int ttn_best_response(std::uint64_t n_infos, std::uint64_t n_sequences, const std::uint64_t* parents,
                      const std::uint64_t* first, const std::uint16_t* actions, double* values, int maximize) noexcept {
    if (!n_sequences) return 1;
    for (std::uint64_t index=n_infos; index-- > 0;) {
        const unsigned count=__builtin_popcount(static_cast<unsigned>(actions[index]));
        if (!count || first[index]>=n_sequences || count>n_sequences-first[index] || parents[index]>=first[index]) return 1;
        double best=values[first[index]];
        for (unsigned j=1;j<count;++j) { const double v=values[first[index]+j]; if (maximize ? v>best : v<best) best=v; }
        values[parents[index]] += best;
    }
    return 0;
}

int ttn_best_response_plan(std::uint64_t n_infos, std::uint64_t n_sequences, const std::uint64_t* parents,
                           const std::uint64_t* first, const std::uint16_t* actions, double* values, int maximize,
                           std::uint8_t* realization, double* potentials, double* secondary) noexcept {
    try {
        if (!n_sequences) return 1;
        std::vector<std::uint8_t> choices(n_infos);
        for (std::uint64_t index=n_infos; index-- > 0;) {
            const unsigned count=__builtin_popcount(static_cast<unsigned>(actions[index]));
            if (!count || first[index]>=n_sequences || count>n_sequences-first[index] || parents[index]>=first[index]) return 1;
            double best=values[first[index]], second_best=secondary ? secondary[first[index]] : 0.0;
            unsigned choice=0;
            for (unsigned j=1;j<count;++j) {
                const double v=values[first[index]+j], s=secondary ? secondary[first[index]+j] : 0.0;
                if ((maximize ? v>best : v<best) || (v==best && (maximize ? s>second_best : s<second_best))) { best=v; second_best=s; choice=j; }
            }
            choices[index]=static_cast<std::uint8_t>(choice);
            potentials[index+1]=-best;
            values[parents[index]] += best;
            if (secondary) secondary[parents[index]] += second_best;
        }
        potentials[0]=values[0]; realization[0]=1;
        for (std::uint64_t index=0; index<n_infos; ++index) if (realization[parents[index]]) realization[first[index]+choices[index]]=1;
        return 0;
    } catch (...) { set_error("Unable to construct complete best response"); return 1; }
}

const char* ttn_error() noexcept { return last_error; }

void* ttn_build(std::uint16_t hidden, int start, std::uint16_t o_mask, std::uint16_t x_mask,
                std::uint16_t tried_o, std::uint16_t tried_x, int turn,
                std::uint64_t obs_o_lo, std::uint64_t obs_o_hi,
                std::uint64_t obs_x_lo, std::uint64_t obs_x_hi,
                std::uint64_t node_limit, void* control) noexcept {
    last_error[0]='\0';
    try {
        if (!payoff_merge_self_check()) throw std::runtime_error("Native payoff merge self-check failed");
        if (((hidden|o_mask|x_mask|tried_o|tried_x)&~FULL_MASK)!=0) throw std::invalid_argument("Board and tried masks must fit the nine-cell board");
        if ((start!=O&&start!=X)||(turn!=O&&turn!=X)) throw std::invalid_argument("Starting player and turn must be O (2) or X (1)");
        const u128 obs_o=(static_cast<u128>(obs_o_hi)<<64)|obs_o_lo;
        const u128 obs_x=(static_cast<u128>(obs_x_hi)<<64)|obs_x_lo;
        auto game=std::make_unique<Game>(hidden,node_limit,static_cast<Control*>(control));
        game->visit(o_mask,x_mask,tried_o,tried_x,turn,obs_o,obs_x,0,0);
        game->finalize_payoff();
        game->o.release_index(); game->x.release_index();
        return game.release();
    } catch (const std::bad_alloc&) { set_error("Insufficient memory while enumerating the complete exact game"); }
      catch (const std::exception& e) { set_error(e.what()); }
      catch (...) { set_error("Unknown native enumeration failure"); }
    return nullptr;
}

void ttn_free(void* p) noexcept { delete static_cast<Game*>(p); }

std::uint64_t ttn_count(void* p, int field) noexcept {
    if (!p) { set_error("Cannot read counts from a null game"); return 0; }
    const Game& g=*static_cast<Game*>(p);
    switch (field) {
        case 0:return g.histories; case 1:return g.terminals; case 2:return g.o.obs_low.size(); case 3:return g.x.obs_low.size();
        case 4:return g.o.n_sequences; case 5:return g.x.n_sequences; case 6:return g.payoff_nnz();
        case 7:return g.decisive_terminals; case 8:return g.payoff_flushes; default:set_error("Unknown count field"); return 0;
    }
}

const void* ttn_data(void* p, int field) noexcept {
    if (!p) { set_error("Cannot read data from a null game"); return nullptr; }
    const Game& g=*static_cast<Game*>(p);
    if (field>=0&&field<5) return catalog_data(g.o,field);
    if (field>=5&&field<10) return catalog_data(g.x,field-5);
    set_error("Unknown data field"); return nullptr;
}

int ttn_payoff_csr(void* p, int index_bits, void* indptr, void* indices, double* data) noexcept {
    if (!p || !indptr) { set_error("Invalid payoff CSR game/row buffer"); return 1; }
    try {
        const Game& g=*static_cast<Game*>(p);
        if (g.payoff_nnz() && (!indices || !data)) {
            set_error("Invalid nonempty payoff CSR column/data buffer");
            return 1;
        }
        if (index_bits==32) return fill_payoff_csr<std::int32_t>(g, static_cast<std::int32_t*>(indptr), static_cast<std::int32_t*>(indices), data);
        if (index_bits==64) return fill_payoff_csr<std::int64_t>(g, static_cast<std::int64_t*>(indptr), static_cast<std::int64_t*>(indices), data);
        set_error("Payoff CSR index width must be 32 or 64 bits"); return 1;
    } catch (const std::exception& e) { set_error(e.what()); return 1; }
      catch (...) { set_error("Unable to materialize native payoff CSR"); return 1; }
}

} // extern C