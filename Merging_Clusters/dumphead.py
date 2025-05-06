from astropy.io import fits
import sys
import numpy as np

import glob, os, shutil

def dumphead(imagefile, headfile):

    img = fits.open(imagefile)
    header = img[0].header

    header.totextfile(headfile, overwrite=True)


if __name__ == "__main__":

    import argparse

    #parser = argparse.ArgumentParser(description='Make a color image from HST drizzled images.')
    #parser.add_argument("--input", help="Input filename for the header dump.")
    #parser.add_argument("--output", help="Output filename for the header dump.")
    #args = parser.parse_args()
    parent_dir = os.path.abspath('..')

    clusters = [d for d in os.listdir(parent_dir) if os.path.isdir(os.path.join(parent_dir, d))]

    for cluster in clusters:
        print(cluster)
        mean_files = glob.glob('../'+cluster+'/analysis/mean_*.fits')
        try:
            mean_file = mean_files[-1]
            dumphead(mean_file, cluster+'.head')
        except IndexError:
            pass

    for cluster in clusters:
        try:
            shutil.copy('../'+cluster+'/analysis/signal_to_noise_fiatmap_median.fits', cluster+'_WL_SN.fits')
        except FileNotFoundError:
            pass
