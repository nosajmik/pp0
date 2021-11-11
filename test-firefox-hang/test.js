let arr = new Uint8Array(32 * 1024 * 1024);
let junk = 0;

while (true) {
    junk ^= arr[Math.random() * arr.length];
}
