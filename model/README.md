# Air Canvas Handwriting Recognition Model Directory

This directory hosts the client-side TensorFlow.js Convolutional Neural Network model for touchless handwriting recognition (`Write` mode).

## Expected Files

Once trained and converted, this folder should contain:
- `model.json` (Model topology and weight manifest)
- `group1-shard1of1.bin` (Binary weights)
- `classes.json` (Optional metadata with class mapping)

## How to Train & Generate the Model

Run the included training script from the root of the project:

```bash
# 1. Install dependencies
pip install tensorflow tensorflowjs tensorflow-datasets numpy

# 2. Train and export directly to this folder
python train_handwriting.py --epochs 12 --output_dir ./model
```

The script trains a CNN on the EMNIST Balanced dataset (47 classes: 0-9 digits, A-Z uppercase, and distinct lowercase letters), normalizes orientation, and automatically runs `tensorflowjs_converter` to export the target files here.

## Graceful Fallback

If `model.json` is not present, Air Canvas gracefully disables the `Write` mode toggle with an informative notification while preserving all drawing, gesture selection, and shape snapping features.
