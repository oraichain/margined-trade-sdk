## Generate code and docs

```bash
# build code:
cwtools build ../perpetuals/contracts/margined_* -o packages/contracts-build/data
# gen code:
cwtools gents ../perpetuals/contracts/margined_* -o packages/contracts-sdk/src
# gen doc:
yarn docs

# update comments:
git apply patches/contracts-sdk.patch
# edit contracts-sdk
git diff packages/contracts-sdk > patches/contracts-sdk.patch
# rollback
git checkout packages/contracts-sdk
```
