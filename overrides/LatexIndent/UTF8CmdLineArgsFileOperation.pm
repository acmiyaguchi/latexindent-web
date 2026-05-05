package LatexIndent::UTF8CmdLineArgsFileOperation;

# Zeroperl POC replacement: stripped of Encode/Win32 dependencies. The original
# module exists to deal with Windows code-page conversions and diacritics in
# filenames; under WASI in a browser we feed UTF-8 strings through MEMFS and
# never touch native Win32 APIs, so all "with_encode" wrappers are pass-through.

use strict;
use warnings;
use feature qw( say state );
use utf8;

use Exporter qw/import/;
our @EXPORT_OK = qw/
    commandlineargs_with_encode @new_args
    copy_with_encode exist_with_encode open_with_encode
    zero_with_encode read_yaml_with_encode
    isdir_with_encode mkdir_with_encode
/;

our @new_args;

sub commandlineargs_with_encode {
    @new_args = @ARGV;
}

sub copy_with_encode {
    require File::Copy;
    File::Copy::copy(@_);
}

sub exist_with_encode { return -e $_[0]; }
sub zero_with_encode  { return -z $_[0]; }
sub isdir_with_encode { return -d $_[0]; }

sub open_with_encode {
    my ($mode, $filename) = @_;
    if (open(my $fh, $mode, $filename)) { return $fh; }
    return undef;
}

sub read_yaml_with_encode {
    require YAML::Tiny;
    my $filename = shift;
    my $fh = open_with_encode('<:utf8', $filename) or return undef;
    my $yaml_string = join('', <$fh>);
    return YAML::Tiny->read_string($yaml_string);
}

sub mkdir_with_encode {
    require File::Path;
    File::Path::make_path($_[0]);
}

1;
